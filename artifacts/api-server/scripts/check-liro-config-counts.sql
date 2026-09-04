/* ============================================================
   Read-only check: how many config (category-A) tables actually
   hold data for the LiRo POC tenant (LiRoDemo).
   Run inside the database that has the FULL LiRo schema (Docker).
   Nothing is written — pure COUNT(*).
   ============================================================ */
SET NOCOUNT ON;

DECLARE @tpl  NVARCHAR(256) = N'fcec991c-0b1c-4e41-8200-92c20ea3f536'; -- LiRo POC (LiRoDemo)
DECLARE @list NVARCHAR(MAX) = N'ACRTypes,ApplicationModules,ApplicationRole,ApplicationServers,Applications,CRMGeographies,CRMRelationshipType,CRMVerticals,CheckListRoleTemplates,CheckListRoles,CheckListTaskTemplates,CheckListTemplates,Config_BudgetCategories,Config_ClientAdminCategory,Config_ClientAdminConfigurationLists,Config_ConfigurationVariable,Config_Dashboard_DashboardFactTables,Config_Dashboard_DashboardPanelView,Config_Dashboard_DashboardPanels,Config_LeadCriteria,Config_MailTokenColumnName,Config_MasterAgreement,Config_Master_RankingCriteria,Config_MenuNavigation,Config_ModuleLifeCycles,Config_ModuleMonitorOptions,Config_ModuleMonitors,Config_Module_DefaultValues,Config_Module_EscalationRule,Config_Module_FormLayout,Config_Module_Impact,Config_Module_ModuleColumns,Config_Module_ModuleFormTab,Config_Module_ModuleStages,Config_Module_ModuleUserTypes,Config_Module_Priority,Config_Module_RequestPriority,Config_Module_RequestRoleWriteAccess,Config_Module_RequestType,Config_Module_SLARule,Config_Module_Severity,Config_Modules,Config_PageConfiguration,Config_ProjectClass,Config_ProjectComplexity,Config_ProjectInitiative,Config_Service_ServiceCategories,Config_Service_ServiceDefaultValues,Config_Service_ServiceQuestions,Config_Service_ServiceSections,Config_Services,Config_TabView,Config_WikiLeftNavigation,ContactExperienceTags,DRQRapidTypes,DRQSystemAreas,EmployeeTypes,ExperiencedTags,FieldConfiguration,FunctionRole,FunctionRoleMapping,FunctionalAreas,GenericStatus,GovernanceLinkCategory,HelpCard,HelpCardContent,LandingPages,LinkCategory,LinkView,ModuleStageConstraintTemplates,ProjectAllocationTemplates,ProjectSimilarityConfig,ReportMenu,SchedulerActions,Studio,TaskTemplates,Templates,TenantScheduler,WikiArticles,WikiContents';

IF OBJECT_ID('tempdb..#r') IS NOT NULL DROP TABLE #r;
CREATE TABLE #r (TableName SYSNAME, [Rows] BIGINT NULL);

DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql = STRING_AGG(CONVERT(NVARCHAR(MAX),
  'INSERT INTO #r SELECT N''' + value + ''',' +
  CASE
    WHEN COL_LENGTH('dbo.' + value, 'TenantID') IS NULL
      THEN 'NULL'                                              -- table missing or no TenantID col
    ELSE '(SELECT COUNT(*) FROM dbo.[' + value + '] WHERE TenantID=@tpl)'
  END
), ';' + CHAR(10))
FROM STRING_SPLIT(@list, ',');

EXEC sp_executesql @sql, N'@tpl NVARCHAR(256)', @tpl = @tpl;

-- Per-table detail (tables with data first)
SELECT TableName, [Rows]
FROM #r
ORDER BY CASE WHEN [Rows] IS NULL THEN 2 WHEN [Rows] = 0 THEN 1 ELSE 0 END,
         [Rows] DESC, TableName;

-- Summary
SELECT
  SUM(CASE WHEN [Rows] > 0  THEN 1 ELSE 0 END) AS tables_with_data,
  SUM(CASE WHEN [Rows] = 0  THEN 1 ELSE 0 END) AS tables_empty,
  SUM(CASE WHEN [Rows] IS NULL THEN 1 ELSE 0 END) AS tables_missing_or_no_tenantcol,
  COUNT(*) AS total_checked
FROM #r;
