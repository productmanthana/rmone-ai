import { Feather, Ionicons } from "@/lib/icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useScreenBeacon } from "@/lib/usageBeacon";
import {
  getFleet,
  getSuperadminCompanyProfile,
  updateSuperadminCompanyProfile,
  getSuperadminCompanyAdmins,
  addSuperadminCompanyAdmin,
  type CompanyAdmin,
  type CompanyProfileFields,
  type TenantSummary,
} from "@/lib/api";

// ── Constants ────────────────────────────────────────────────────────────────

const COUNTRIES = [
  "", "United States", "Canada", "United Kingdom", "Australia", "New Zealand",
  "Ireland", "Germany", "France", "Netherlands", "Singapore", "Other",
];
const INDUSTRIES = ["", "Construction", "Engineering", "Architecture", "Real Estate", "Other"];
const OWNERSHIP_TYPES = ["", "Private", "Public", "Joint Venture", "Non-Profit", "Other"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "#6BA539";
  if (score >= 50) return "#E87722";
  return "#E05252";
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
}

// ── SelectPicker — native-friendly "select" alternative ──────────────────────
// Renders a pressable row that cycles through options (simple approach for
// lists short enough to fit a scrollable modal).

function SelectPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={spStyles.wrap}>
        <Text style={spStyles.label}>{label}</Text>
        <Pressable style={spStyles.row} onPress={() => setOpen(true)}>
          <Text style={[spStyles.value, !value && spStyles.placeholder]} numberOfLines={1}>
            {value || `Select ${label.toLowerCase()}…`}
          </Text>
          <Feather name="chevron-down" size={14} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {open && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={spStyles.overlay} onPress={() => setOpen(false)}>
            <View style={spStyles.sheet}>
              <Text style={spStyles.sheetTitle}>{label}</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {options.map((opt) => (
                  <Pressable
                    key={opt || "__blank__"}
                    style={[spStyles.option, value === opt && spStyles.optionActive]}
                    onPress={() => { onChange(opt); setOpen(false); }}
                  >
                    <Text style={[spStyles.optionText, value === opt && spStyles.optionTextActive]}>
                      {opt || `— None —`}
                    </Text>
                    {value === opt && <Feather name="check" size={14} color={Colors.green} />}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const spStyles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontFamily: "Inter_500Medium", fontSize: 11, color: Colors.textSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.dark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  value: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, flex: 1, marginRight: 8 },
  placeholder: { color: Colors.textMuted },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: Colors.darkDeep,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  sheetTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: Colors.textPrimary,
    marginBottom: 14,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  optionActive: { backgroundColor: Colors.green + "15" },
  optionText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary },
  optionTextActive: { fontFamily: "Inter_600SemiBold", color: Colors.green },
});

// ── CompanyDrillDown modal ───────────────────────────────────────────────────

function CompanyDrillDown({
  tenant,
  onClose,
}: {
  tenant: TenantSummary;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  // Profile form state
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("");
  const [industry, setIndustry] = useState("");
  const [ownershipType, setOwnershipType] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  // Admins state
  const [admins, setAdmins] = useState<CompanyAdmin[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState(false);

  const displayName = tenant.displayName || tenant.tenantId;

  // Load profile on mount
  useEffect(() => {
    setProfileLoading(true);
    getSuperadminCompanyProfile(tenant.tenantId)
      .then(({ profile }) => {
        setWebsite(profile.website ?? "");
        setPhone(profile.phone ?? "");
        setCompanyEmail(profile.companyEmail ?? "");
        setStreetAddress(profile.streetAddress ?? "");
        setCity(profile.city ?? "");
        setState(profile.state ?? "");
        setZip(profile.zip ?? "");
        setCountry(profile.country ?? "");
        setIndustry(profile.industry ?? "");
        setOwnershipType(profile.ownershipType ?? "");
        setLicenseNumber(profile.licenseNumber ?? "");
        setProfileLoaded(true);
      })
      .catch(() => {
        setProfileLoaded(true);
      })
      .finally(() => setProfileLoading(false));
  }, [tenant.tenantId]);

  // Load admins on mount
  useEffect(() => {
    setAdminsLoading(true);
    getSuperadminCompanyAdmins(tenant.tenantId)
      .then(({ admins: list }) => {
        setAdmins(list);
        setAdminsLoaded(true);
      })
      .catch(() => {
        setAdminsLoaded(true);
      })
      .finally(() => setAdminsLoading(false));
  }, [tenant.tenantId]);

  const handleAddAdmin = async () => {
    const trimName = addName.trim();
    const trimEmail = addEmail.trim();
    if (!trimName) { setAddErr("Name is required"); return; }
    if (!trimEmail || !trimEmail.includes("@")) { setAddErr("A valid email address is required"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAdding(true);
    setAddErr("");
    setAddOk(false);
    try {
      const result = await addSuperadminCompanyAdmin(tenant.tenantId, trimName, trimEmail);
      setAdmins((prev) => [...prev, { userGuid: result.userGuid, name: result.name, email: result.email, isDefault: false }]);
      setAddName("");
      setAddEmail("");
      setAddOk(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setAddOk(false), 4000);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Failed to add admin");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setAdding(false);
    }
  };

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setSaveOk(false);
    setSaveErr("");
    const fields: CompanyProfileFields = {
      website: website.trim() || undefined,
      phone: phone.trim() || undefined,
      companyEmail: companyEmail.trim() || undefined,
      streetAddress: streetAddress.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      country: country || undefined,
      industry: industry || undefined,
      ownershipType: ownershipType || undefined,
      licenseNumber: licenseNumber.trim() || undefined,
    };
    try {
      await updateSuperadminCompanyProfile(tenant.tenantId, fields);
      setSaveOk(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setSaveOk(false), 4000);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const sc = scoreColor(tenant.readinessScore);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: Colors.darkDeep }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0) }} />

        {/* Header */}
        <View style={drillStyles.header}>
          <Pressable style={drillStyles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={drillStyles.headerTitle} numberOfLines={1}>{displayName}</Text>
            <Text style={drillStyles.headerSub} numberOfLines={1}>{tenant.tenantId}</Text>
          </View>
          <View style={[drillStyles.scorePill, { backgroundColor: sc + "22", borderColor: sc + "66" }]}>
            <Text style={[drillStyles.scoreText, { color: sc }]}>{tenant.readinessScore}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[drillStyles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Quick stats */}
          <View style={drillStyles.statsRow}>
            {[
              { label: "Total Projects", value: fmt(tenant.projectCount) },
              { label: "Staff", value: fmt(tenant.staffCount) },
              { label: "Opps", value: fmt(tenant.oppCount) },
              { label: "Assigns", value: fmt(tenant.assignmentCount) },
            ].map((s) => (
              <View key={s.label} style={drillStyles.statCell}>
                <Text style={drillStyles.statValue}>{s.value}</Text>
                <Text style={drillStyles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          <View style={drillStyles.metaRow}>
            <View style={drillStyles.metaChip}>
              <View style={[drillStyles.statusDot, { backgroundColor: tenant.isActive ? Colors.green : "#E05252" }]} />
              <Text style={drillStyles.metaText}>{tenant.isActive ? "Active" : "Inactive"}</Text>
            </View>
            <View style={drillStyles.metaChip}>
              <Feather name="clock" size={11} color={Colors.textSecondary} />
              <Text style={drillStyles.metaText}>Imported {timeAgo(tenant.latestImportAt)}</Text>
            </View>
            <View style={drillStyles.metaChip}>
              <Feather name="upload" size={11} color={Colors.textSecondary} />
              <Text style={drillStyles.metaText}>{tenant.runCount} run{tenant.runCount !== 1 ? "s" : ""}</Text>
            </View>
          </View>

          {/* Edit Profile section */}
          <View style={drillStyles.sectionHeader}>
            <Feather name="edit-2" size={13} color={Colors.green} />
            <Text style={drillStyles.sectionTitle}>Edit Profile</Text>
          </View>

          {profileLoading ? (
            <View style={drillStyles.loadingWrap}>
              <ActivityIndicator color={Colors.green} />
              <Text style={drillStyles.loadingText}>Loading profile…</Text>
            </View>
          ) : !profileLoaded ? null : (
            <View style={drillStyles.profileCard}>
              {/* Contact */}
              <Text style={drillStyles.groupLabel}>CONTACT</Text>

              <View style={drillStyles.fieldRow}>
                <View style={{ flex: 1 }}>
                  <Text style={drillStyles.fieldLabel}>Website URL</Text>
                  <TextInput
                    style={drillStyles.input}
                    value={website}
                    onChangeText={setWebsite}
                    placeholder="https://acme.com"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={drillStyles.fieldLabel}>Phone</Text>
                  <TextInput
                    style={drillStyles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+1 (555) 000-0000"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <View style={drillStyles.fieldSingle}>
                <Text style={drillStyles.fieldLabel}>Company email</Text>
                <TextInput
                  style={drillStyles.input}
                  value={companyEmail}
                  onChangeText={setCompanyEmail}
                  placeholder="info@acme.com"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              {/* Address */}
              <Text style={[drillStyles.groupLabel, { marginTop: 18 }]}>ADDRESS</Text>

              <View style={drillStyles.fieldSingle}>
                <Text style={drillStyles.fieldLabel}>Street address</Text>
                <TextInput
                  style={drillStyles.input}
                  value={streetAddress}
                  onChangeText={setStreetAddress}
                  placeholder="123 Main Street"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>

              <View style={drillStyles.fieldRow}>
                <View style={{ flex: 1 }}>
                  <Text style={drillStyles.fieldLabel}>City</Text>
                  <TextInput
                    style={drillStyles.input}
                    value={city}
                    onChangeText={setCity}
                    placeholder="New York"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={drillStyles.fieldLabel}>State / Province</Text>
                  <TextInput
                    style={drillStyles.input}
                    value={state}
                    onChangeText={setState}
                    placeholder="NY"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
              </View>

              <View style={drillStyles.fieldRow}>
                <View style={{ flex: 1 }}>
                  <Text style={drillStyles.fieldLabel}>ZIP / Postal code</Text>
                  <TextInput
                    style={drillStyles.input}
                    value={zip}
                    onChangeText={setZip}
                    placeholder="10001"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SelectPicker
                    label="Country"
                    value={country}
                    options={COUNTRIES}
                    onChange={setCountry}
                  />
                </View>
              </View>

              {/* Business Profile */}
              <Text style={[drillStyles.groupLabel, { marginTop: 18 }]}>BUSINESS PROFILE</Text>

              <View style={drillStyles.fieldRow}>
                <View style={{ flex: 1 }}>
                  <SelectPicker
                    label="Industry / Sector"
                    value={industry}
                    options={INDUSTRIES}
                    onChange={setIndustry}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SelectPicker
                    label="Ownership type"
                    value={ownershipType}
                    options={OWNERSHIP_TYPES}
                    onChange={setOwnershipType}
                  />
                </View>
              </View>

              <View style={drillStyles.fieldSingle}>
                <Text style={drillStyles.fieldLabel}>Contractor license number</Text>
                <TextInput
                  style={drillStyles.input}
                  value={licenseNumber}
                  onChangeText={setLicenseNumber}
                  placeholder="e.g. LIC-123456"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>

              {/* Feedback + Save */}
              {saveErr ? (
                <View style={drillStyles.errorBanner}>
                  <Feather name="alert-circle" size={13} color="#E05252" />
                  <Text style={drillStyles.errorText}>{saveErr}</Text>
                </View>
              ) : null}

              {saveOk ? (
                <View style={drillStyles.successBanner}>
                  <Feather name="check-circle" size={13} color={Colors.green} />
                  <Text style={drillStyles.successText}>Profile saved successfully.</Text>
                </View>
              ) : null}

              <Pressable
                style={[drillStyles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="save" size={14} color="#fff" />
                )}
                <Text style={drillStyles.saveBtnText}>{saving ? "Saving…" : "Save Profile"}</Text>
              </Pressable>
            </View>
          )}

          {/* Site Admins section */}
          <View style={drillStyles.sectionHeader}>
            <Feather name="shield" size={13} color={Colors.green} />
            <Text style={drillStyles.sectionTitle}>Site Admins</Text>
          </View>

          <View style={drillStyles.profileCard}>
            {adminsLoading ? (
              <View style={drillStyles.loadingWrap}>
                <ActivityIndicator color={Colors.green} />
                <Text style={drillStyles.loadingText}>Loading admins…</Text>
              </View>
            ) : adminsLoaded && admins.length === 0 ? (
              <Text style={drillStyles.adminsEmptyText}>No site admins yet for this company.</Text>
            ) : (
              admins.map((admin) => (
                <View key={admin.userGuid} style={drillStyles.adminRow}>
                  <View style={drillStyles.adminAvatar}>
                    <Feather name="user" size={14} color={Colors.green} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={drillStyles.adminNameRow}>
                      <Text style={drillStyles.adminName} numberOfLines={1}>{admin.name || "—"}</Text>
                      {admin.isDefault && (
                        <View style={drillStyles.defaultBadge}>
                          <Text style={drillStyles.defaultBadgeText}>Default</Text>
                        </View>
                      )}
                    </View>
                    <Text style={drillStyles.adminEmail} numberOfLines={1}>{admin.email}</Text>
                  </View>
                </View>
              ))
            )}

            {/* Add admin form */}
            <Text style={[drillStyles.groupLabel, { marginTop: admins.length > 0 ? 16 : 4 }]}>ADD ADMIN</Text>

            <View style={drillStyles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={drillStyles.fieldLabel}>Full name</Text>
                <TextInput
                  style={drillStyles.input}
                  value={addName}
                  onChangeText={setAddName}
                  placeholder="Jane Smith"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                  editable={!adding}
                />
              </View>
            </View>

            <View style={drillStyles.fieldSingle}>
              <Text style={drillStyles.fieldLabel}>Email address</Text>
              <TextInput
                style={drillStyles.input}
                value={addEmail}
                onChangeText={setAddEmail}
                placeholder="jane@acme.com"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!adding}
              />
            </View>

            {addErr ? (
              <View style={drillStyles.errorBanner}>
                <Feather name="alert-circle" size={13} color="#E05252" />
                <Text style={drillStyles.errorText}>{addErr}</Text>
              </View>
            ) : null}

            {addOk ? (
              <View style={drillStyles.successBanner}>
                <Feather name="check-circle" size={13} color={Colors.green} />
                <Text style={drillStyles.successText}>Admin added. An invite email should be sent to activate their account.</Text>
              </View>
            ) : null}

            <Pressable
              style={[drillStyles.saveBtn, adding && { opacity: 0.6 }]}
              onPress={handleAddAdmin}
              disabled={adding}
            >
              {adding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="user-plus" size={14} color="#fff" />
              )}
              <Text style={drillStyles.saveBtnText}>{adding ? "Adding…" : "Add Admin"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const drillStyles = themed(() =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: Colors.darkCard,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 16,
      color: Colors.textPrimary,
    },
    headerSub: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: Colors.textSecondary,
      marginTop: 1,
    },
    scorePill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      borderWidth: 1,
    },
    scoreText: {
      fontFamily: "Inter_700Bold",
      fontSize: 14,
    },
    scroll: {
      paddingHorizontal: 16,
      paddingTop: 18,
      gap: 12,
    },
    statsRow: {
      flexDirection: "row",
      backgroundColor: Colors.darkCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: Colors.border,
      overflow: "hidden",
    },
    statCell: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 14,
      borderRightWidth: 1,
      borderRightColor: Colors.border,
    },
    statValue: {
      fontFamily: "Inter_700Bold",
      fontSize: 18,
      color: Colors.textPrimary,
    },
    statLabel: {
      fontFamily: "Inter_400Regular",
      fontSize: 10,
      color: Colors.textSecondary,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: Colors.darkCard,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    metaText: {
      fontFamily: "Inter_500Medium",
      fontSize: 11,
      color: Colors.textSecondary,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
    },
    sectionTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 13,
      color: Colors.textPrimary,
      letterSpacing: 0.3,
    },
    loadingWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 20,
    },
    loadingText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: Colors.textSecondary,
    },
    profileCard: {
      backgroundColor: Colors.darkCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: 16,
      gap: 12,
    },
    groupLabel: {
      fontFamily: "Inter_700Bold",
      fontSize: 10,
      color: Colors.textMuted,
      letterSpacing: 0.8,
    },
    fieldRow: {
      flexDirection: "row",
      gap: 10,
    },
    fieldSingle: {
      gap: 4,
    },
    fieldLabel: {
      fontFamily: "Inter_500Medium",
      fontSize: 11,
      color: Colors.textSecondary,
      marginBottom: 4,
    },
    input: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: Colors.textPrimary,
      backgroundColor: Colors.dark,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "#E0525215",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "#E0525240",
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    errorText: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: "#E05252",
      flex: 1,
    },
    successBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: Colors.green + "15",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: Colors.green + "40",
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    successText: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: Colors.green,
    },
    saveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: Colors.green,
      borderRadius: 12,
      paddingVertical: 13,
    },
    saveBtnText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: "#FFFFFF",
    },
    adminsEmptyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: Colors.textMuted,
      textAlign: "center",
      paddingVertical: 8,
    },
    adminRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    adminAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: Colors.green + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    adminNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    adminName: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: Colors.textPrimary,
      flex: 1,
    },
    adminEmail: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: Colors.textSecondary,
      marginTop: 2,
    },
    defaultBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: Colors.green + "20",
    },
    defaultBadgeText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 10,
      color: Colors.green,
    },
  }),
);

// ── Company card ─────────────────────────────────────────────────────────────

function CompanyCard({
  tenant,
  onPress,
}: {
  tenant: TenantSummary;
  onPress: () => void;
}) {
  const sc = scoreColor(tenant.readinessScore);
  const displayName = tenant.displayName || tenant.tenantId;

  return (
    <Pressable style={cardStyles.card} onPress={onPress}>
      <View style={cardStyles.top}>
        <View style={[cardStyles.scoreBadge, { backgroundColor: sc + "22", borderColor: sc + "55" }]}>
          <Text style={[cardStyles.scoreNum, { color: sc }]}>{tenant.readinessScore}</Text>
          <Text style={[cardStyles.scoreOf, { color: sc }]}>/100</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={cardStyles.name} numberOfLines={1}>{displayName}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
            <View style={[cardStyles.dot, { backgroundColor: tenant.isActive ? Colors.green : "#E05252" }]} />
            <Text style={cardStyles.sub} numberOfLines={1}>
              {tenant.isActive ? "Active" : "Inactive"} · {tenant.projectCount}P / {tenant.staffCount}S · {timeAgo(tenant.latestImportAt)}
            </Text>
          </View>
        </View>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </View>

      {/* Mini sparkline */}
      {tenant.activitySparkline && tenant.activitySparkline.length > 1 && (
        <View style={cardStyles.sparkRow}>
          {tenant.activitySparkline.slice(-12).map((v, i) => {
            const max = Math.max(...tenant.activitySparkline, 1);
            const h = Math.max(3, Math.round((v / max) * 24));
            return (
              <View
                key={i}
                style={[
                  cardStyles.sparkBar,
                  {
                    height: h,
                    backgroundColor: v > 0 ? Colors.green + "99" : Colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

const cardStyles = themed(() =>
  StyleSheet.create({
    card: {
      backgroundColor: Colors.darkCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 10,
    },
    top: {
      flexDirection: "row",
      alignItems: "center",
    },
    scoreBadge: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 1,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 10,
      borderWidth: 1,
    },
    scoreNum: {
      fontFamily: "Inter_700Bold",
      fontSize: 16,
    },
    scoreOf: {
      fontFamily: "Inter_400Regular",
      fontSize: 10,
    },
    name: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: Colors.textPrimary,
    },
    sub: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: Colors.textSecondary,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    sparkRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 3,
      height: 26,
    },
    sparkBar: {
      flex: 1,
      borderRadius: 2,
    },
  }),
);

// ── Main screen ──────────────────────────────────────────────────────────────

export default function SuperadminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useScreenBeacon("Superadmin");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [selected, setSelected] = useState<TenantSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const { tenants: rows } = await getFleet();
      setTenants(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = tenants.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (t.displayName ?? "").toLowerCase().includes(q) ||
      t.tenantId.toLowerCase().includes(q)
    );
  });

  const totalProjects = tenants.reduce((s, t) => s + t.projectCount, 0);
  const totalStaff = tenants.reduce((s, t) => s + t.staffCount, 0);
  const activeCount = tenants.filter((t) => t.isActive).length;

  return (
    <View style={[s.root, { backgroundColor: Colors.dark }]}>
      <View style={{ height: Math.max(insets.top, Platform.OS === "web" ? 54 : 0), backgroundColor: Colors.darkDeep }} />

      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.title}>Command Center</Text>
          <Text style={s.subtitle}>Superadmin fleet management</Text>
        </View>
        <Pressable
          style={s.refreshBtn}
          onPress={() => load(true)}
          disabled={refreshing}
        >
          {refreshing
            ? <ActivityIndicator size="small" color={Colors.green} />
            : <Feather name="refresh-cw" size={16} color={Colors.green} />
          }
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green} />
          <Text style={s.loadingText}>Loading fleet…</Text>
        </View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={28} color="#E05252" />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={() => load()}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Fleet summary */}
          <View style={s.summaryRow}>
            <View style={s.summaryCell}>
              <Text style={s.summaryValue}>{tenants.length}</Text>
              <Text style={s.summaryLabel}>Companies</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryValue}>{activeCount}</Text>
              <Text style={s.summaryLabel}>Active</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryValue}>{fmt(totalProjects)}</Text>
              <Text style={s.summaryLabel}>Projects</Text>
            </View>
            <View style={s.summaryCell}>
              <Text style={s.summaryValue}>{fmt(totalStaff)}</Text>
              <Text style={s.summaryLabel}>Staff</Text>
            </View>
          </View>

          {/* Search */}
          <View style={s.searchWrap}>
            <Feather name="search" size={14} color={Colors.textMuted} style={{ marginLeft: 12 }} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search companies…"
              placeholderTextColor={Colors.textMuted}
              clearButtonMode="while-editing"
            />
          </View>

          {/* Company list */}
          {filtered.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="inbox" size={28} color={Colors.textMuted} />
              <Text style={s.emptyText}>
                {search ? "No companies match your search." : "No companies found."}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {filtered.map((t) => (
                <CompanyCard
                  key={t.tenantId}
                  tenant={t}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelected(t);
                  }}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {selected && (
        <CompanyDrillDown
          tenant={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
      backgroundColor: Colors.darkDeep,
    },
    backBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: Colors.darkCard,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: "Inter_700Bold",
      fontSize: 17,
      color: Colors.textPrimary,
    },
    subtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: Colors.textSecondary,
      marginTop: 1,
    },
    refreshBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingHorizontal: 32,
    },
    loadingText: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: Colors.textSecondary,
    },
    errorText: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: Colors.textSecondary,
      textAlign: "center",
    },
    retryBtn: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: Colors.darkCard,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    retryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: Colors.textPrimary,
    },
    scroll: {
      paddingHorizontal: 16,
      paddingTop: 18,
      gap: 14,
    },
    summaryRow: {
      flexDirection: "row",
      backgroundColor: Colors.darkCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: Colors.border,
      overflow: "hidden",
    },
    summaryCell: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 16,
      borderRightWidth: 1,
      borderRightColor: Colors.border,
    },
    summaryValue: {
      fontFamily: "Inter_700Bold",
      fontSize: 20,
      color: Colors.green,
    },
    summaryLabel: {
      fontFamily: "Inter_400Regular",
      fontSize: 10,
      color: Colors.textSecondary,
      marginTop: 3,
    },
    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.darkCard,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Colors.border,
      overflow: "hidden",
    },
    searchInput: {
      flex: 1,
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: Colors.textPrimary,
      paddingHorizontal: 10,
      paddingVertical: 11,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 48,
      gap: 10,
    },
    emptyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: Colors.textMuted,
      textAlign: "center",
    },
  }),
);
