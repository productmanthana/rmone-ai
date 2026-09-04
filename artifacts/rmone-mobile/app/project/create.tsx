import { AppTextInput } from "@/components/AppTextInput";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Feather } from "@/lib/icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, themed } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { useScreenBeacon } from "@/lib/usageBeacon";
import { globalAlert, globalConfirm } from "@/lib/inAppAlert";
import CalendarPopup from "@/components/CalendarPopup";
import {
  createRecord,
  getLifecycles,
  createSchedule,
  getDivisions,
  getUsers,
  createBusinessUnits,
  uploadAttachment,
} from "@/lib/api";

type ModuleType = "PMM" | "OPM";
type Step =
  | "module"
  | "details"
  | "creating"
  | "business-unit"
  | "lifecycle"
  | "schedule"
  | "complete";

interface DivisionItem {
  ID: number;
  Title: string;
  ShortName: string | null;
}

interface UserItem {
  id: string;
  name: string;
}

interface BUEntry {
  divisionId: string;
  divisionName: string;
  divisionShort: string;
  type: "Primary" | "Supporting";
  businessLeadId: string;
  businessLeadName: string;
  projectManagerId: string;
  projectManagerName: string;
  contractValue: string;
}

interface AttachmentFile {
  name: string;
  uri: string;
  mimeType: string;
  size: number;
}

interface LifecycleItem {
  ID: number;
  Name: string;
  Stages: { ID: number; Name: string; StageStep: number }[];
}

interface ScheduleTask {
  ID: number;
  Title: string;
  StartDate: string;
  DueDate: string;
  Status: string;
  PercentComplete: number;
  ItemOrder: number;
  TicketId: string;
  AssignedTo: string;
  isSelected: boolean;
  StageStep: number;
}

const PMM_LIFECYCLE_ID = "14";
const OPM_LIFECYCLE_ID = "18";

function formatDate(offset: number): string {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function generateTasksFromStages(
  stages: { Name: string; StageStep: number }[],
  ticketId: string,
  assignedTo: string,
  moduleType: ModuleType,
): ScheduleTask[] {
  let filtered = [...stages].sort((a, b) => a.StageStep - b.StageStep);
  if (moduleType === "OPM") {
    filtered = filtered.filter(s => s.Name !== "Project Complete");
  }
  const tasks: ScheduleTask[] = [];
  if (moduleType === "OPM") {
    tasks.push({
      ID: 0, Title: "Proposal", StartDate: formatDate(0), DueDate: formatDate(14),
      Status: "Not Started", PercentComplete: 0, ItemOrder: 0, TicketId: ticketId,
      AssignedTo: assignedTo, isSelected: true, StageStep: 0,
    });
  }
  filtered.forEach((stage, i) => {
    const baseOffset = moduleType === "OPM" ? 14 + i * 21 : i * 14;
    tasks.push({
      ID: -(i + 1),
      Title: moduleType === "OPM" ? `Phase ${i + 1}${stage.Name.includes("Closeout") ? " - Closeout" : ""}` : stage.Name,
      StartDate: formatDate(baseOffset),
      DueDate: formatDate(baseOffset + (moduleType === "OPM" ? 20 : 13)),
      Status: "Not Started", PercentComplete: 0,
      ItemOrder: moduleType === "OPM" ? i + 1 : stage.StageStep,
      TicketId: ticketId, AssignedTo: assignedTo,
      isSelected: true, StageStep: moduleType === "OPM" ? i + 1 : stage.StageStep,
    });
  });
  return tasks;
}

export default function CreateProjectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const canEditData = user?.capabilities.editData === true;
  useScreenBeacon("CreateRecord");

  const [step, setStep] = useState<Step>("module");
  const [moduleType, setModuleType] = useState<ModuleType>("PMM");
  const [projectName, setProjectName] = useState("");
  const [erpJobId, setErpJobId] = useState("");
  const [description, setDescription] = useState("");
  const [companyLookup, setCompanyLookup] = useState("");
  const [bidDueDate, setBidDueDate] = useState("");
  const [priority, setPriority] = useState("");
  const [requestType, setRequestType] = useState("");
  const [projectExecutive, setProjectExecutive] = useState("");
  const [opmComment, setOpmComment] = useState("");
  const [opmOpportunityType, setOpmOpportunityType] = useState("");
  const [opmGoAfter, setOpmGoAfter] = useState("");
  const [opmChanceOfSuccess, setOpmChanceOfSuccess] = useState("");
  const [opmMasterAgreement, setOpmMasterAgreement] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);

  const [loading, setLoading] = useState(false);
  const [createdRecordId, setCreatedRecordId] = useState("");
  const [createdRecordName, setCreatedRecordName] = useState("");

  const [divisions, setDivisions] = useState<DivisionItem[]>([]);
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [buEntries, setBuEntries] = useState<BUEntry[]>([]);
  const [showDivPicker, setShowDivPicker] = useState(false);
  const [showUserPicker, setShowUserPicker] = useState<{ field: string; buIndex: number } | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const [lifecycles, setLifecycles] = useState<LifecycleItem[]>([]);
  const [selectedLifecycle, setSelectedLifecycle] = useState("");
  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTask[]>([]);

  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState<string | null>(null);
  const [showTaskDatePicker, setShowTaskDatePicker] = useState<{ index: number; field: "StartDate" | "DueDate" } | null>(null);

  const addLog = useCallback((msg: string) => {
    setStatusLog((prev) => [...prev, msg]);
  }, []);

  const pickAttachment = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets) {
        const newFiles: AttachmentFile[] = result.assets.map(a => ({
          name: a.name,
          uri: a.uri,
          mimeType: a.mimeType || "application/octet-stream",
          size: a.size || 0,
        }));
        setAttachments(prev => [...prev, ...newFiles]);
      }
    } catch (e) {
      globalAlert("Error", "Could not pick file: " + String(e));
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const uploadAllAttachments = async (ticketId: string) => {
    if (attachments.length === 0) return;
    addLog(`Uploading ${attachments.length} attachment(s)...`);
    for (const file of attachments) {
      try {
        let base64: string;
        if (Platform.OS === "web") {
          const resp = await fetch(file.uri);
          const blob = await resp.blob();
          base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              resolve(result.split(",")[1] || "");
            };
            reader.readAsDataURL(blob);
          });
        } else {
          base64 = await FileSystem.readAsStringAsync(file.uri, {
            encoding: "base64",
          });
        }
        await uploadAttachment({
          TicketId: ticketId,
          FileName: file.name,
          FileContent: base64,
          ContentType: file.mimeType,
        });
        addLog(`  ✓ ${file.name}`);
      } catch (e) {
        addLog(`  ✗ ${file.name}: ${String(e)}`);
      }
    }
  };

  // Duplicate-title confirm state (mirrors the web create pages):
  //  - dupOkTitleRef holds the lowercase title the user explicitly confirmed
  //    via "Create anyway"; a rename invalidates it (compared at submit time).
  //  - submitInFlightRef is a SYNCHRONOUS double-submit guard — the async
  //    `loading` state can lag a fast double-tap or a confirm-dialog resubmit.
  //  - handleCreateRef always points at the LATEST handler so the confirm
  //    dialog (which outlives its render) resubmits with CURRENT form state,
  //    never a stale closure.
  const dupOkTitleRef = useRef("");
  const submitInFlightRef = useRef(false);
  const handleCreateRef = useRef<() => void>(() => {});

  const handleCreateRecord = async () => {
    if (!canEditData) { globalAlert("View only", "You do not have permission to create or edit project data."); return; }
    if (!projectName.trim()) { globalAlert("Required", "Please enter a project name."); return; }
    if (!erpJobId.trim()) { globalAlert("Required", "Please enter an ERP Job ID."); return; }
    if (createdRecordId) return; // already created — never double-create
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setLoading(true);
    setStep("creating");
    setStatusLog([]);
    addLog(`Creating ${moduleType} record...`);

    try {
      let fields: { FieldName: string; Value: string }[];
      if (moduleType === "PMM") {
        fields = [
          { FieldName: "ERPJobID", Value: erpJobId.trim() },
          // The ERP Job ID doubles as the record's TicketId — IDs are
          // mandatory, the backend never auto-generates one.
          { FieldName: "TicketId", Value: erpJobId.trim() },
          { FieldName: "ShortName", Value: projectName.trim() },
          { FieldName: "Attachments", Value: "" },
          { FieldName: "Description", Value: description.trim() },
          { FieldName: "BidDueDate", Value: bidDueDate.trim() },
          { FieldName: "PriorityLookup", Value: priority.trim() },
          { FieldName: "RequestTypeLookup", Value: requestType.trim() },
          { FieldName: "ProjectExecutiveUser", Value: projectExecutive.trim() },
          { FieldName: "OwnerUser", Value: user?.userId ?? "" },
          { FieldName: "Title", Value: projectName.trim() },
          { FieldName: "CRMCompanyLookup", Value: companyLookup.trim() },
        ];
      } else {
        fields = [
          { FieldName: "MasterAgreementLookup", Value: opmMasterAgreement.trim() },
          { FieldName: "ERPJobIDNC", Value: erpJobId.trim() },
          // The ERP Job ID doubles as the record's TicketId — IDs are
          // mandatory, the backend never auto-generates one.
          { FieldName: "TicketId", Value: erpJobId.trim() },
          { FieldName: "CRMCompanyLookup", Value: companyLookup.trim() },
          { FieldName: "Attachments", Value: "" },
          { FieldName: "Comment", Value: opmComment.trim() },
          { FieldName: "Description", Value: description.trim() },
          { FieldName: "BidDueDate", Value: bidDueDate.trim() },
          { FieldName: "RequestTypeLookup", Value: requestType.trim() },
          { FieldName: "OpportunityTypeChoice", Value: opmOpportunityType.trim() },
          { FieldName: "ProjectExecutiveUser", Value: projectExecutive.trim() },
          { FieldName: "OwnerUser", Value: user?.userId ?? "" },
          { FieldName: "Title", Value: projectName.trim() },
          { FieldName: "GoAfterChoice", Value: opmGoAfter.trim() },
          { FieldName: "ChanceOfSuccessChoice", Value: opmChanceOfSuccess.trim() },
          { FieldName: "Get", Value: "" },
          { FieldName: "Go", Value: "" },
          { FieldName: "Win", Value: "" },
        ];
      }

      // Attach the duplicate-title confirmation ONLY when the user explicitly
      // confirmed THIS title via "Create anyway" (a rename since then makes
      // the comparison fail, so a stale confirmation never leaks forward).
      if (dupOkTitleRef.current === projectName.trim().toLowerCase()) {
        fields.push({ FieldName: "ConfirmDuplicateTitle", Value: "1" });
      }

      const result = await createRecord(moduleType, fields);
      const res = result as any;

      // Server gate: same name but a clearly DIFFERENT job (client/BU/division
      // conflict) → allowed, but only after an explicit confirmation. Show a
      // confirm step instead of dead-ending; on confirm, resubmit via the
      // latest-handler ref with current form state.
      if (res?.Status === false && res?.code === "DUP_TITLE_DIFFERENT_JOB") {
        submitInFlightRef.current = false;
        setLoading(false);
        setStep("details");
        const noun = moduleType === "OPM" ? "opportunity" : "project";
        globalConfirm(
          "Same name, different job?",
          res?.error
            ? String(res.error)
            : `A ${noun} named "${projectName.trim()}" already exists but appears to be a different job. Create another record with the same name?`,
          () => {
            dupOkTitleRef.current = projectName.trim().toLowerCase();
            handleCreateRef.current();
          },
          "Create anyway",
        );
        return;
      }

      // Any other explicit rejection (e.g. possibly the SAME job) — surface
      // it loudly and return to the form instead of stalling on the log step.
      if (res?.Status === false) {
        submitInFlightRef.current = false;
        setLoading(false);
        setStep("details");
        globalAlert("Could not create record", String(res?.error ?? "The server rejected this create."));
        return;
      }

      const data = res?.Data ?? result;
      const recordId = data?.RecordCode ?? data?.TicketId ?? data?.RecordId ?? "";

      if (!recordId) {
        addLog("Error: No record ID returned from server.");
        setLoading(false);
        return;
      }

      setCreatedRecordId(recordId);
      setCreatedRecordName(projectName.trim());
      addLog(`Created: ${recordId}`);

      await uploadAllAttachments(recordId);

      addLog("Loading divisions & users...");
      try {
        const [divData, userData] = await Promise.all([getDivisions(), getUsers()]);
        setDivisions(Array.isArray(divData) ? divData : []);
        setUsersList(Array.isArray(userData) ? userData : []);
        addLog(`Loaded ${(Array.isArray(divData) ? divData : []).length} divisions, ${(Array.isArray(userData) ? userData : []).length} users`);
      } catch {
        addLog("Could not load divisions/users.");
      }

      setStep("business-unit");
      setLoading(false);
    } catch (e) {
      const friendly = (e as any)?.friendlyMessage;
      addLog(`Error: ${friendly ? String(friendly) : String(e)}`);
      setLoading(false);
    } finally {
      submitInFlightRef.current = false;
    }
  };
  // Keep the ref pointing at the LATEST handler — the confirm dialog's
  // callback outlives the render it was created in.
  handleCreateRef.current = handleCreateRecord;

  const addBUEntry = (div: DivisionItem) => {
    const hasPrimary = buEntries.some(b => b.type === "Primary");
    setBuEntries(prev => [...prev, {
      divisionId: String(div.ID),
      divisionName: div.Title,
      divisionShort: div.ShortName || div.Title.slice(0, 4).toUpperCase(),
      type: hasPrimary ? "Supporting" : "Primary",
      businessLeadId: "", businessLeadName: "",
      projectManagerId: "", projectManagerName: "",
      contractValue: "",
    }]);
    setShowDivPicker(false);
  };

  const removeBUEntry = (index: number) => {
    setBuEntries(prev => prev.filter((_, i) => i !== index));
  };

  const updateBUField = (index: number, field: keyof BUEntry, value: string) => {
    setBuEntries(prev => prev.map((b, i) => i === index ? { ...b, [field]: value } : b));
  };

  const selectUserForBU = (u: UserItem) => {
    if (!showUserPicker) return;
    const { field, buIndex } = showUserPicker;
    if (field === "businessLead") {
      updateBUField(buIndex, "businessLeadId", u.id);
      updateBUField(buIndex, "businessLeadName", u.name);
    } else {
      updateBUField(buIndex, "projectManagerId", u.id);
      updateBUField(buIndex, "projectManagerName", u.name);
    }
    setShowUserPicker(null);
    setUserSearch("");
  };

  const handleSubmitBUs = async () => {
    if (buEntries.length === 0) {
      loadLifecycles();
      return;
    }
    const primaryCount = buEntries.filter(b => b.type === "Primary").length;
    if (primaryCount !== 1) {
      globalAlert("Validation", "Exactly one Business Unit must be marked as Primary.");
      return;
    }
    setLoading(true);
    addLog("Creating business units...");
    try {
      await createBusinessUnits({
        TicketID: createdRecordId,
        ProjectDivisionRoles: buEntries.map(b => ({
          ID: 0, TicketID: null,
          DivisionIDLookup: b.divisionId, Type: b.type,
          BusinessLeadUser: b.businessLeadName, BusinessLeadUserID: b.businessLeadId,
          ProjectManagerUserID: b.projectManagerId, ProjectManagerUser: b.projectManagerName,
          ContractValue: b.contractValue || "0",
          Deleted: false, Title: null, DivisionShortName: b.divisionShort,
          ProjectMultiplier: 0, PendChgOrders: null, AllocationCount: 0,
        })),
      });
      addLog("Business units created.");
    } catch (e) {
      addLog(`BU error: ${String(e)}`);
    }
    loadLifecycles();
  };

  const loadLifecycles = async () => {
    setLoading(true);
    addLog("Fetching lifecycles...");
    try {
      const lcData = await getLifecycles();
      const lcList = Array.isArray(lcData) ? lcData : [];
      setLifecycles(lcList as LifecycleItem[]);
      const defaultLC = moduleType === "PMM" ? PMM_LIFECYCLE_ID : OPM_LIFECYCLE_ID;
      setSelectedLifecycle(defaultLC);
      const selected = lcList.find((l: any) => String(l.ID) === defaultLC);
      if (selected && (selected as any).Stages) {
        const tasks = generateTasksFromStages(
          (selected as any).Stages, createdRecordId, user?.userId ?? "", moduleType,
        );
        setScheduleTasks(tasks);
      }
    } catch {
      addLog("Could not load lifecycles.");
    }
    setStep("lifecycle");
    setLoading(false);
  };

  const onLifecycleSelect = (lcId: string) => {
    setSelectedLifecycle(lcId);
    const selected = lifecycles.find(l => String(l.ID) === lcId);
    if (selected?.Stages) {
      const tasks = generateTasksFromStages(
        selected.Stages, createdRecordId, user?.userId ?? "", moduleType,
      );
      setScheduleTasks(tasks);
    }
  };

  const handleCreateSchedule = async () => {
    if (!canEditData) { globalAlert("View only", "You do not have permission to edit project schedules."); return; }
    if (!selectedLifecycle) {
      addLog("Please select a lifecycle template before creating the schedule.");
      return;
    }
    setLoading(true);
    const lifecycleId = selectedLifecycle;
    addLog(`Creating schedule (lifecycle ${lifecycleId})...`);

    try {
      await createSchedule({
        TicketID: createdRecordId,
        ProjectLifecycleID: lifecycleId,
        ProjectScheduleExists: false,
        TargetStartDate: "0001-01-01T00:00:00",
        TargetCompletionDate: "0001-01-01T00:00:00",
        Tasks: scheduleTasks,
      });
      addLog("Schedule created successfully.");
    } catch (e) {
      addLog(`Schedule note: ${String(e)}`);
    }

    setStep("complete");
    setLoading(false);
  };

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
        <Feather name="arrow-left" size={22} color={Colors.white} />
      </Pressable>
      <Text style={styles.headerTitle}>New {moduleType} Project</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const renderStepIndicator = () => {
    const steps = ["Module", "Details", "BU", "Lifecycle", "Schedule"];
    const stepIndex =
      step === "module" ? 0 : step === "details" ? 1 : step === "creating" ? 1
      : step === "business-unit" ? 2 : step === "lifecycle" ? 3 : 4;

    return (
      <View style={styles.stepRow}>
        {steps.map((s, i) => (
          <View key={s} style={styles.stepItem}>
            <View style={[styles.stepDot, i <= stepIndex && styles.stepDotActive, i < stepIndex && styles.stepDotDone]}>
              {i < stepIndex ? (
                <Feather name="check" size={12} color="#fff" />
              ) : (
                <Text style={[styles.stepNum, i <= stepIndex && styles.stepNumActive]}>{i + 1}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, i <= stepIndex && styles.stepLabelActive]}>{s}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderModuleStep = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Select Module</Text>
      <Text style={styles.cardSub}>Choose the type of project to create</Text>
      <View style={styles.moduleRow}>
        {(["PMM", "OPM"] as ModuleType[]).map((m) => (
          <Pressable
            key={m}
            style={[styles.moduleCard, moduleType === m && styles.moduleCardActive]}
            onPress={() => setModuleType(m)}
          >
            <Feather name={m === "PMM" ? "briefcase" : "target"} size={28}
              color={moduleType === m ? Colors.green : Colors.textSecondary} />
            <Text style={[styles.moduleLabel, moduleType === m && styles.moduleLabelActive]}>{m}</Text>
            <Text style={styles.moduleDesc}>{m === "PMM" ? "Project Management" : "Opportunity Pipeline"}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.primaryBtn} onPress={() => setStep("details")}>
        <Text style={styles.primaryBtnText}>Next</Text>
        <Feather name="arrow-right" size={18} color="#fff" />
      </Pressable>
    </View>
  );

  const renderIconField = (
    icon: keyof typeof Feather.glyphMap, label: string, value: string,
    onChange: (t: string) => void, placeholder: string,
    required?: boolean, multiline?: boolean,
  ) => (
    <View style={styles.iconFieldRow}>
      <View style={styles.iconFieldIcon}>
        <Feather name={icon} size={16} color={Colors.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.iconFieldLabel}>
          {label}{required ? <Text style={{ color: Colors.orange }}> *</Text> : null}
        </Text>
        <AppTextInput
          style={[styles.iconFieldInput, multiline ? { height: 60, textAlignVertical: "top" } : null]}
          value={value} onChangeText={onChange} placeholder={placeholder}
          placeholderTextColor={Colors.textMuted} multiline={multiline}
          numberOfLines={multiline ? 2 : 1}
        />
      </View>
    </View>
  );

  const renderDateField = (
    icon: keyof typeof Feather.glyphMap, label: string, value: string,
    onChange: (d: string) => void, pickerId: string,
  ) => {
    return (
      <View style={styles.iconFieldRow}>
        <View style={styles.iconFieldIcon}>
          <Feather name={icon} size={16} color={Colors.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.iconFieldLabel}>{label}</Text>
          <Pressable
            style={styles.datePickerBtn}
            onPress={() => setShowDatePicker(pickerId)}
          >
            <Text style={[styles.datePickerText, !value && { color: Colors.textMuted }]}>
              {value || "Select date..."}
            </Text>
            <Feather name="calendar" size={16} color={Colors.green} />
          </Pressable>
          {showDatePicker === pickerId && Platform.OS === "web" && (
            <CalendarPopup
              initialValue={value || ""}
              onPick={(iso) => { onChange(iso); setShowDatePicker(null); }}
              onClose={() => setShowDatePicker(null)}
            />
          )}
          {showDatePicker === pickerId && Platform.OS !== "web" && (
            <DateTimePicker
              value={value ? new Date(value + "T00:00:00") : new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "calendar"}
              themeVariant="dark"
              onChange={(_, selectedDate) => {
                setShowDatePicker(null);
                if (selectedDate) {
                  onChange(selectedDate.toISOString().slice(0, 10));
                }
              }}
            />
          )}
        </View>
      </View>
    );
  };

  const renderDetailsStep = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Project Details</Text>
      <Text style={styles.cardSub}>Fill in the details for your {moduleType} project</Text>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionDot} />
        <Text style={styles.sectionTitle}>Required</Text>
      </View>
      {renderIconField("edit-3", "Project Name", projectName, setProjectName, "e.g. Downtown Office Renovation", true)}
      {renderIconField("hash", "ERP Job ID", erpJobId, setErpJobId, moduleType === "PMM" ? "e.g. 15.04.26 1" : "e.g. opm150426 1", true)}

      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: Colors.textMuted }]} />
        <Text style={styles.sectionTitle}>Optional</Text>
      </View>
      {renderIconField("file-text", "Description", description, setDescription, "Brief project description", false, true)}

      <View style={styles.iconFieldRow}>
        <View style={styles.iconFieldIcon}>
          <Feather name="paperclip" size={16} color={Colors.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.iconFieldLabel}>Attachments</Text>
          {attachments.length > 0 && (
            <View style={styles.attachList}>
              {attachments.map((file, i) => (
                <View key={i} style={styles.attachItem}>
                  <Feather name={file.mimeType.startsWith("image/") ? "image" : "file"} size={14} color={Colors.green} />
                  <Text style={styles.attachName} numberOfLines={1}>{file.name}</Text>
                  <Text style={styles.attachSize}>{(file.size / 1024).toFixed(0)} KB</Text>
                  <Pressable onPress={() => removeAttachment(i)} hitSlop={8}>
                    <Feather name="x-circle" size={16} color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <Pressable style={styles.attachPickerBtn} onPress={pickAttachment}>
            <Feather name="upload" size={14} color={Colors.green} />
            <Text style={styles.attachPickerText}>
              {attachments.length > 0 ? "Add More Files" : "Choose Files"}
            </Text>
          </Pressable>
        </View>
      </View>

      {renderDateField("calendar", "Bid Due Date", bidDueDate, setBidDueDate, "bidDueDate")}

      {renderIconField("tag", "Request Type", requestType, setRequestType, "Type")}

      {moduleType === "PMM" && (
        <View style={styles.twoColRow}>
          <View style={{ flex: 1 }}>
            {renderIconField("flag", "Priority", priority, setPriority, "High / Med / Low")}
          </View>
          <View style={{ flex: 1 }}>
            {renderIconField("briefcase", "CRM Company", companyLookup, setCompanyLookup, "Company")}
          </View>
        </View>
      )}

      {moduleType === "OPM" && (
        <>
          <View style={styles.twoColRow}>
            <View style={{ flex: 1 }}>
              {renderIconField("briefcase", "CRM Company", companyLookup, setCompanyLookup, "Company")}
            </View>
            <View style={{ flex: 1 }}>
              {renderIconField("layers", "Opportunity Type", opmOpportunityType, setOpmOpportunityType, "Type")}
            </View>
          </View>
          <View style={styles.twoColRow}>
            <View style={{ flex: 1 }}>
              {renderIconField("target", "Go After", opmGoAfter, setOpmGoAfter, "Yes / No")}
            </View>
            <View style={{ flex: 1 }}>
              {renderIconField("percent", "Chance of Success", opmChanceOfSuccess, setOpmChanceOfSuccess, "%")}
            </View>
          </View>
          {renderIconField("link", "Master Agreement", opmMasterAgreement, setOpmMasterAgreement, "Agreement lookup")}
          {renderIconField("message-circle", "Comment", opmComment, setOpmComment, "Comment", false, true)}
        </>
      )}

      {renderIconField("user", "Project Executive", projectExecutive, setProjectExecutive, "Executive user")}

      {user?.userId ? (
        <View style={styles.ownerBadge}>
          <Feather name="shield" size={14} color={Colors.green} />
          <Text style={styles.ownerBadgeText}>Owner: {user.username} (auto-assigned)</Text>
        </View>
      ) : null}

      <View style={styles.btnRow}>
        <Pressable style={styles.secondaryBtn} onPress={() => setStep("module")}>
          <Feather name="arrow-left" size={18} color={Colors.white} />
          <Text style={styles.secondaryBtnText}>Back</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, (!projectName.trim() || !erpJobId.trim()) && styles.btnDisabled]}
          onPress={handleCreateRecord} disabled={!canEditData || !projectName.trim() || !erpJobId.trim()}
        >
          <Text style={styles.primaryBtnText}>Create Project</Text>
          <Feather name="plus" size={18} color="#fff" />
        </Pressable>
      </View>
    </View>
  );

  const renderCreatingStep = () => (
    <View style={styles.card}>
      <ActivityIndicator size="large" color={Colors.green} />
      <Text style={[styles.cardTitle, { marginTop: 16 }]}>Creating Project...</Text>
      {statusLog.map((msg, i) => (
        <Text key={i} style={styles.logLine}>{msg}</Text>
      ))}
    </View>
  );

  const renderBUStep = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Business Units</Text>
      <Text style={styles.cardSub}>
        Project <Text style={{ color: Colors.green }}>{createdRecordId}</Text> created.
        Add business units (one must be Primary).
      </Text>

      {buEntries.map((bu, idx) => (
        <View key={idx} style={styles.buCard}>
          <View style={styles.buCardHeader}>
            <View style={[styles.buTypeBadge, bu.type === "Primary" ? styles.buPrimary : styles.buSupporting]}>
              <Text style={styles.buTypeText}>{bu.type}</Text>
            </View>
            <Text style={styles.buDivName}>{bu.divisionShort} - {bu.divisionName}</Text>
            <Pressable onPress={() => removeBUEntry(idx)} hitSlop={8}>
              <Feather name="x" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.buTypeToggle}>
            {(["Primary", "Supporting"] as const).map(t => (
              <Pressable key={t} onPress={() => updateBUField(idx, "type", t)}
                style={[styles.buTypeOption, bu.type === t && styles.buTypeOptionActive]}>
                <Text style={[styles.buTypeOptionText, bu.type === t && styles.buTypeOptionTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.buPickerBtn}
            onPress={() => { setUserSearch(""); setShowUserPicker({ field: "businessLead", buIndex: idx }); }}>
            <Feather name="user" size={14} color={Colors.green} />
            <Text style={styles.buPickerLabel}>Business Lead:</Text>
            <Text style={styles.buPickerValue}>{bu.businessLeadName || "Select..."}</Text>
          </Pressable>

          <Pressable style={styles.buPickerBtn}
            onPress={() => { setUserSearch(""); setShowUserPicker({ field: "projectManager", buIndex: idx }); }}>
            <Feather name="users" size={14} color={Colors.green} />
            <Text style={styles.buPickerLabel}>Project Manager:</Text>
            <Text style={styles.buPickerValue}>{bu.projectManagerName || "Select..."}</Text>
          </Pressable>

          <View style={styles.buContractRow}>
            <Feather name="dollar-sign" size={14} color={Colors.green} />
            <Text style={styles.buPickerLabel}>Contract Value:</Text>
            <AppTextInput style={styles.buContractInput} value={bu.contractValue}
              onChangeText={(v) => updateBUField(idx, "contractValue", v)}
              placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
          </View>
        </View>
      ))}

      <Pressable style={styles.addBuBtn} onPress={() => setShowDivPicker(true)}>
        <Feather name="plus-circle" size={18} color={Colors.green} />
        <Text style={styles.addBuText}>Add Business Unit</Text>
      </Pressable>

      <View style={styles.btnRow}>
        <Pressable style={styles.secondaryBtn} onPress={() => setStep("details")}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </Pressable>
        <Pressable style={styles.primaryBtn} onPress={handleSubmitBUs} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Text style={styles.primaryBtnText}>{buEntries.length > 0 ? "Create BUs & Next" : "Skip"}</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </>
          )}
        </Pressable>
      </View>

      {statusLog.length > 0 && (
        <View style={styles.logBox}>
          {statusLog.map((msg, i) => <Text key={i} style={styles.logLine}>{msg}</Text>)}
        </View>
      )}

      <Modal visible={showDivPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Division</Text>
            <FlatList
              data={divisions.filter(d => !buEntries.some(b => b.divisionId === String(d.ID)))}
              keyExtractor={d => String(d.ID)}
              renderItem={({ item }) => (
                <Pressable style={styles.modalItem} onPress={() => addBUEntry(item)}>
                  <Text style={styles.modalItemText}>{item.ShortName || ""} - {item.Title}</Text>
                </Pressable>
              )}
              style={{ maxHeight: 400 }}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowDivPicker(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!showUserPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Select {showUserPicker?.field === "businessLead" ? "Business Lead" : "Project Manager"}
            </Text>
            <AppTextInput style={styles.modalSearch} value={userSearch} onChangeText={setUserSearch}
              placeholder="Search users..." placeholderTextColor={Colors.textMuted} />
            <FlatList
              data={usersList.filter(u => u.name.toLowerCase().includes(userSearch.toLowerCase()))}
              keyExtractor={u => u.id}
              renderItem={({ item }) => (
                <Pressable style={styles.modalItem} onPress={() => selectUserForBU(item)}>
                  <Text style={styles.modalItemText}>{item.name}</Text>
                </Pressable>
              )}
              style={{ maxHeight: 350 }}
            />
            <Pressable style={styles.modalClose} onPress={() => { setShowUserPicker(null); setUserSearch(""); }}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );

  const renderLifecycleStep = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Select Lifecycle</Text>
      <Text style={styles.cardSub}>Choose lifecycle to generate schedule phases</Text>

      {lifecycles.length === 0 ? (
        <Text style={styles.emptyText}>No lifecycles loaded. Default will be used.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 200 }}>
          {lifecycles.map((lc) => (
            <Pressable key={lc.ID}
              style={[styles.listItem, selectedLifecycle === String(lc.ID) && styles.listItemActive]}
              onPress={() => onLifecycleSelect(String(lc.ID))}>
              <Feather name={selectedLifecycle === String(lc.ID) ? "check-circle" : "circle"}
                size={20} color={selectedLifecycle === String(lc.ID) ? Colors.green : Colors.textMuted} />
              <Text style={[styles.listItemText, selectedLifecycle === String(lc.ID) && styles.listItemTextActive]}>
                {lc.Name}
              </Text>
              <Text style={styles.stageCount}>{lc.Stages?.length ?? 0} stages</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {scheduleTasks.length > 0 && (
        <View style={styles.taskPreview}>
          <Text style={styles.taskPreviewTitle}>Schedule Preview ({scheduleTasks.length} phases)</Text>
          {scheduleTasks.map((t, i) => (
            <View key={i} style={styles.taskCard}>
              <View style={styles.taskRow}>
                <View style={[styles.taskDot, { backgroundColor: Colors.green }]} />
                <Text style={styles.taskName}>{t.Title}</Text>
              </View>
              <View style={styles.taskDatesRow}>
                <>
                  <Pressable style={styles.taskDateBtn}
                    onPress={() => setShowTaskDatePicker({ index: i, field: "StartDate" })}>
                    <Feather name="play" size={10} color={Colors.green} />
                    <Text style={styles.taskDateLabel}>{t.StartDate}</Text>
                  </Pressable>
                  <Feather name="arrow-right" size={12} color={Colors.textMuted} />
                  <Pressable style={styles.taskDateBtn}
                    onPress={() => setShowTaskDatePicker({ index: i, field: "DueDate" })}>
                    <Feather name="flag" size={10} color={Colors.orange} />
                    <Text style={styles.taskDateLabel}>{t.DueDate}</Text>
                  </Pressable>
                  {showTaskDatePicker?.index === i && Platform.OS === "web" && (
                    <CalendarPopup
                      initialValue={(showTaskDatePicker.field === "StartDate" ? t.StartDate : t.DueDate) || ""}
                      onPick={(iso) => {
                        setScheduleTasks(prev => prev.map((task, idx) =>
                          idx === i ? { ...task, [showTaskDatePicker!.field]: iso } : task
                        ));
                        setShowTaskDatePicker(null);
                      }}
                      onClose={() => setShowTaskDatePicker(null)}
                    />
                  )}
                  {showTaskDatePicker?.index === i && Platform.OS !== "web" && (
                    <DateTimePicker
                      value={new Date((showTaskDatePicker.field === "StartDate" ? t.StartDate : t.DueDate) + "T00:00:00")}
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "calendar"}
                      themeVariant="dark"
                      onChange={(_, selectedDate) => {
                        if (selectedDate) {
                          const dateStr = selectedDate.toISOString().slice(0, 10);
                          setScheduleTasks(prev => prev.map((task, idx) =>
                            idx === i ? { ...task, [showTaskDatePicker!.field]: dateStr } : task
                          ));
                        }
                        setShowTaskDatePicker(null);
                      }}
                    />
                  )}
                </>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.btnRow}>
        <Pressable style={styles.secondaryBtn} onPress={() => setStep("business-unit")}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </Pressable>
        <Pressable style={[styles.primaryBtn, (!canEditData || !selectedLifecycle || loading) && { opacity: 0.5 }]} onPress={handleCreateSchedule} disabled={!canEditData || loading || !selectedLifecycle}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Text style={styles.primaryBtnText}>Create Schedule</Text>
              <Feather name="calendar" size={18} color="#fff" />
            </>
          )}
        </Pressable>
      </View>

      {statusLog.length > 0 && (
        <View style={styles.logBox}>
          {statusLog.map((msg, i) => <Text key={i} style={styles.logLine}>{msg}</Text>)}
        </View>
      )}
    </View>
  );

  const renderCompleteStep = () => (
    <View style={styles.card}>
      <View style={styles.completeIcon}>
        <Feather name="check-circle" size={48} color={Colors.green} />
      </View>
      <Text style={[styles.cardTitle, { textAlign: "center" }]}>Project Created</Text>
      <Text style={[styles.cardSub, { textAlign: "center" }]}>{createdRecordName}</Text>
      <Text style={[styles.cardSub, { textAlign: "center", color: Colors.green }]}>{createdRecordId}</Text>

      {statusLog.length > 0 && (
        <View style={styles.logBox}>
          {statusLog.map((msg, i) => <Text key={i} style={styles.logLine}>{msg}</Text>)}
        </View>
      )}

      <View style={styles.btnRow}>
        <Pressable style={styles.secondaryBtn}
          onPress={() => { createdRecordId ? router.replace(`/project/${createdRecordId}`) : router.back(); }}>
          <Feather name="eye" size={18} color={Colors.white} />
          <Text style={styles.secondaryBtnText}>View Project</Text>
        </Pressable>
        <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Back to Projects</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {renderHeader()}
      {renderStepIndicator()}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === "module" && renderModuleStep()}
        {step === "details" && renderDetailsStep()}
        {step === "creating" && renderCreatingStep()}
        {step === "business-unit" && renderBUStep()}
        {step === "lifecycle" && renderLifecycleStep()}
        {step === "schedule" && renderLifecycleStep()}
        {step === "complete" && renderCompleteStep()}
      </ScrollView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, backgroundColor: Colors.darkDeep,
  },
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: Colors.cardText },
  stepRow: {
    flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20,
    paddingVertical: 16, backgroundColor: Colors.darkDeep,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  stepItem: { alignItems: "center", flex: 1 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.darkCard,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: Colors.border,
  },
  stepDotActive: { borderColor: Colors.green },
  stepDotDone: { backgroundColor: Colors.green, borderColor: Colors.green },
  stepNum: { fontSize: 11, fontWeight: "700", color: Colors.textMuted },
  stepNumActive: { color: Colors.green },
  stepLabel: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  stepLabelActive: { color: Colors.textPrimary },
  body: { flex: 1 },
  bodyContent: { padding: 16 },
  card: {
    backgroundColor: Colors.darkCard, borderRadius: 16, padding: 20, marginBottom: 16,
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: Colors.cardText, marginBottom: 4 },
  cardSub: { fontSize: 14, color: Colors.textSecondary, marginBottom: 16 },
  moduleRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  moduleCard: {
    flex: 1, backgroundColor: Colors.dark, borderRadius: 12, padding: 20,
    alignItems: "center", borderWidth: 2, borderColor: Colors.border,
  },
  moduleCardActive: { borderColor: Colors.green, backgroundColor: "rgba(107,165,57,0.1)" },
  moduleLabel: { fontSize: 18, fontWeight: "700", color: Colors.textSecondary, marginTop: 8 },
  moduleLabelActive: { color: Colors.green },
  moduleDesc: { fontSize: 11, color: Colors.textMuted, marginTop: 4, textAlign: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 6 },
  sectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.green },
  sectionTitle: { fontSize: 11, fontWeight: "700", color: Colors.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  iconFieldRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
  iconFieldIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(107,165,57,0.12)",
    alignItems: "center", justifyContent: "center", marginTop: 18,
  },
  iconFieldLabel: { fontSize: 12, fontWeight: "600", color: Colors.textSecondary, marginBottom: 4 },
  iconFieldInput: {
    backgroundColor: Colors.dark, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Colors.cardText, borderWidth: 1, borderColor: Colors.border,
  },
  twoColRow: { flexDirection: "row", gap: 8 },
  ownerBadge: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(107,165,57,0.1)",
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginTop: 6,
    borderWidth: 1, borderColor: "rgba(107,165,57,0.25)",
  },
  ownerBadgeText: { fontSize: 12, color: Colors.green, fontWeight: "500" },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 20 },
  primaryBtn: {
    flex: 1, flexDirection: "row", backgroundColor: Colors.green, borderRadius: 12,
    paddingVertical: 14, alignItems: "center", justifyContent: "center", gap: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  secondaryBtn: {
    flexDirection: "row", backgroundColor: Colors.dark, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 20, alignItems: "center",
    justifyContent: "center", gap: 8, borderWidth: 1, borderColor: Colors.border,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600", color: Colors.cardText },
  btnDisabled: { opacity: 0.5 },
  listItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4,
  },
  listItemActive: { backgroundColor: "rgba(107,165,57,0.1)" },
  listItemText: { fontSize: 15, color: Colors.textSecondary, flex: 1 },
  listItemTextActive: { color: Colors.cardText, fontWeight: "600" },
  stageCount: { fontSize: 11, color: Colors.textMuted },
  buCard: {
    backgroundColor: Colors.dark, borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  buCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  buTypeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  buPrimary: { backgroundColor: "rgba(107,165,57,0.2)" },
  buSupporting: { backgroundColor: "rgba(232,119,34,0.2)" },
  buTypeText: { fontSize: 10, fontWeight: "700", color: Colors.cardText, textTransform: "uppercase" },
  buDivName: { flex: 1, fontSize: 14, fontWeight: "600", color: Colors.cardText },
  buTypeToggle: { flexDirection: "row", gap: 8, marginBottom: 10 },
  buTypeOption: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
    backgroundColor: Colors.darkCard, borderWidth: 1, borderColor: Colors.border,
  },
  buTypeOptionActive: { borderColor: Colors.green, backgroundColor: "rgba(107,165,57,0.1)" },
  buTypeOptionText: { fontSize: 12, color: Colors.textMuted, fontWeight: "600" },
  buTypeOptionTextActive: { color: Colors.green },
  buPickerBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
    paddingHorizontal: 10, backgroundColor: Colors.darkCard, borderRadius: 8, marginBottom: 6,
  },
  buPickerLabel: { fontSize: 12, color: Colors.textSecondary },
  buPickerValue: { fontSize: 12, color: Colors.cardText, fontWeight: "500", flex: 1, textAlign: "right" },
  buContractRow: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4,
    paddingHorizontal: 10, backgroundColor: Colors.darkCard, borderRadius: 8,
  },
  buContractInput: {
    flex: 1, fontSize: 12, color: Colors.cardText, textAlign: "right", padding: 4,
  },
  addBuBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: Colors.green,
    borderStyle: "dashed", marginTop: 4,
  },
  addBuText: { fontSize: 14, color: Colors.green, fontWeight: "600" },
  taskPreview: {
    backgroundColor: Colors.dark, borderRadius: 10, padding: 12, marginTop: 12,
  },
  taskPreviewTitle: { fontSize: 13, fontWeight: "700", color: Colors.textSecondary, marginBottom: 8 },
  taskCard: { marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  taskDot: { width: 6, height: 6, borderRadius: 3 },
  taskName: { flex: 1, fontSize: 13, color: Colors.cardText, fontWeight: "600" },
  taskDate: { fontSize: 11, color: Colors.textMuted },
  taskDatesRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, marginTop: 2 },
  taskDateBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(107,165,57,0.08)", borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  taskDateLabel: { fontSize: 11, color: Colors.textSecondary },
  datePickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: Colors.dark, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  datePickerText: { fontSize: 14, color: Colors.cardText },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.darkCard, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: "70%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: Colors.cardText, marginBottom: 16 },
  modalSearch: {
    backgroundColor: Colors.dark, borderRadius: 10, padding: 12, fontSize: 14,
    color: Colors.cardText, borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  modalItem: {
    paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalItemText: { fontSize: 15, color: Colors.cardText },
  modalClose: {
    marginTop: 12, paddingVertical: 14, alignItems: "center",
    backgroundColor: Colors.dark, borderRadius: 10,
  },
  modalCloseText: { fontSize: 15, color: Colors.textSecondary, fontWeight: "600" },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: "center", paddingVertical: 20 },
  logBox: { marginTop: 16, backgroundColor: Colors.dark, borderRadius: 8, padding: 12 },
  logLine: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  completeIcon: { alignItems: "center", marginBottom: 12 },
  attachList: { marginBottom: 8 },
  attachItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.dark, borderRadius: 8, padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  attachName: { flex: 1, fontSize: 13, color: Colors.cardText },
  attachSize: { fontSize: 11, color: Colors.textMuted },
  attachPickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 10, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.green, borderStyle: "dashed",
  },
  attachPickerText: { fontSize: 13, color: Colors.green, fontWeight: "600" },
}));
