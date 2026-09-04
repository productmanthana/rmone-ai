export function buildStageSql({ stage, sourceTable, columnNames, quoteId }) {
  const columnList = columnNames.map(quoteId).join(",");
  return `
    DROP TABLE IF EXISTS ${stage};
    SELECT ${columnList} INTO ${stage} FROM ${sourceTable};
  `;
}

export function buildReplacementSql({
  qTable,
  stage,
  columnNames,
  hasIdentity,
  quoteId,
}) {
  const columnList = columnNames.map(quoteId).join(",");
  const identityOn = hasIdentity
    ? `SET IDENTITY_INSERT ${qTable} ON;\n`
    : "";
  const identityOff = hasIdentity
    ? `;\nSET IDENTITY_INSERT ${qTable} OFF`
    : "";
  return `
    ALTER TABLE ${qTable} NOCHECK CONSTRAINT ALL;
    DELETE FROM ${qTable};
    ${identityOn}
    INSERT INTO ${qTable} (${columnList})
    SELECT ${columnList} FROM ${stage}
    ${identityOff};
    ALTER TABLE ${qTable} WITH CHECK CHECK CONSTRAINT ALL;
  `;
}