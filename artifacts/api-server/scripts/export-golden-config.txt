#!/usr/bin/env bash
# Exports the golden LiRoDemo tenant's config tables to JSON files in /tmp/onb.
# Uses bcp (no header/width limits). Run inside the Docker container holding
# the full LiRo schema (db: chk).
#
# Credentials are NOT hardcoded. Pass the SA password via env, e.g.:
#   docker exec -e SA_PASSWORD='<sa-pass>' bakcheck bash /tmp/export.sh
set -uo pipefail
PW="${SA_PASSWORD:?Set SA_PASSWORD env (e.g. docker exec -e SA_PASSWORD=... )}"
BCP=/opt/mssql-tools18/bin/bcp
TENANT="fcec991c-0b1c-4e41-8200-92c20ea3f536"
OUT=/tmp/onb
rm -rf "$OUT"; mkdir -p "$OUT"
TABLES="ACRTypes ApplicationModules ApplicationRole ApplicationServers Applications CRMGeographies CRMRelationshipType CRMVerticals CheckListRoleTemplates CheckListRoles CheckListTaskTemplates CheckListTemplates Config_BudgetCategories Config_ClientAdminCategory Config_ClientAdminConfigurationLists Config_ConfigurationVariable Config_Dashboard_DashboardFactTables Config_Dashboard_DashboardPanelView Config_Dashboard_DashboardPanels Config_LeadCriteria Config_MailTokenColumnName Config_MasterAgreement Config_Master_RankingCriteria Config_MenuNavigation Config_ModuleLifeCycles Config_ModuleMonitorOptions Config_ModuleMonitors Config_Module_DefaultValues Config_Module_EscalationRule Config_Module_FormLayout Config_Module_Impact Config_Module_ModuleColumns Config_Module_ModuleFormTab Config_Module_ModuleStages Config_Module_ModuleUserTypes Config_Module_Priority Config_Module_RequestPriority Config_Module_RequestRoleWriteAccess Config_Module_RequestType Config_Module_SLARule Config_Module_Severity Config_Modules Config_PageConfiguration Config_ProjectClass Config_ProjectComplexity Config_ProjectInitiative Config_Service_ServiceCategories Config_Service_ServiceDefaultValues Config_Service_ServiceQuestions Config_Service_ServiceSections Config_Services Config_TabView Config_WikiLeftNavigation ContactExperienceTags DRQRapidTypes DRQSystemAreas EmployeeTypes ExperiencedTags FieldConfiguration FunctionRole FunctionRoleMapping FunctionalAreas GenericStatus GovernanceLinkCategory HelpCard HelpCardContent LandingPages LinkCategory LinkView ModuleStageConstraintTemplates ProjectAllocationTemplates ProjectSimilarityConfig ReportMenu SchedulerActions Studio TaskTemplates Templates TenantScheduler WikiArticles WikiContents"
n=0; withdata=0; failed=0
for t in $TABLES; do
  n=$((n+1))
  "$BCP" "SELECT (SELECT * FROM dbo.[$t] WHERE TenantID='$TENANT' FOR JSON PATH, INCLUDE_NULL_VALUES) AS j" \
    queryout "$OUT/$t.json" -S localhost -U sa -P "$PW" -d chk -u -w \
    > "$OUT/$t.err" 2>&1
  if [ $? -ne 0 ]; then failed=$((failed+1)); echo "EXPORT FAILED: $t (see $OUT/$t.err)"; fi
  sz=$(wc -c < "$OUT/$t.json" 2>/dev/null || echo 0)
  if [ "$sz" -gt 10 ]; then withdata=$((withdata+1)); fi
done
echo "processed $n tables; $withdata have data; $failed failed; output in $OUT"
echo "--- sample sizes (largest first) ---"
ls -S "$OUT"/*.json 2>/dev/null | head -5 | while read f; do echo "$(wc -c < "$f") bytes  $(basename "$f")"; done
[ "$failed" -eq 0 ]
