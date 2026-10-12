const ExcelJS = require('exceljs');
const crypto = require('crypto');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Expected columns configuration.
 * Maps normalized header keys to standard column definitions.
 */
const EXPECTED_COLUMNS = [
  { key: 'employee_id', label: 'Employee ID', aliases: ['employee id', 'employee_id', 'employeeid', 'empid'] },
  { key: 'month', label: 'Month', aliases: ['month'] },
  { key: 'year', label: 'Year', aliases: ['year'] },
  { key: 'working_days', label: 'Working Days', aliases: ['working days', 'working_days', 'workingdays'] },
  { key: 'payable_days', label: 'Payable Days', aliases: ['payable days', 'payable_days', 'payabledays'] },
  { key: 'basic_salary', label: 'Basic Salary', aliases: ['basic salary', 'basic_salary', 'basicsalary', 'basic'] },
  { key: 'hra', label: 'HRA', aliases: ['hra'] },
  { key: 'allowances', label: 'Allowances', aliases: ['allowances', 'allowance'] },
  { key: 'pf_employee', label: 'PF Employee', aliases: ['pf employee', 'pf_employee', 'pf', 'epf'] },
  { key: 'professional_tax', label: 'Professional Tax', aliases: ['professional tax', 'professional_tax', 'pt'] },
  { key: 'other_deductions', label: 'Other Deductions', aliases: ['other deductions', 'other_deductions', 'otherdeductions'] },
];

/**
 * In-memory store for validated import sessions.
 * Key: importId (UUID)
 * Value: { data: [...], summary: {...}, createdAt: timestamp }
 * Automatically expires after 30 minutes.
 */
const importSessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function saveImportSession(sessionData) {
  const importId = crypto.randomUUID();
  importSessions.set(importId, {
    ...sessionData,
    createdAt: Date.now(),
  });
  return importId;
}

function getImportSession(importId) {
  if (!importId || typeof importId !== 'string') return null;
  const session = importSessions.get(importId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    importSessions.delete(importId);
    return null;
  }
  return session;
}

function deleteImportSession(importId) {
  if (importId) {
    importSessions.delete(importId);
  }
}

// Periodic cleanup of stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of importSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      importSessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

/**
 * Normalizes header string for robust comparison.
 */
function normalizeHeader(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extracts raw cell value safely without executing formulas or code.
 */
function getCellValue(cell) {
  if (cell === null || cell === undefined) return '';
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    // If formula cell, check evaluated result
    if ('result' in val) {
      if (val.result !== null && typeof val.result === 'object' && 'error' in val.result) {
        return ''; // Formula error cell like #VALUE!, #REF!, #DIV/0!
      }
      return val.result ?? '';
    }
    if ('error' in val) {
      return '';
    }
    // If rich text
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((t) => t.text).join('');
    }
    // If text property
    if ('text' in val) {
      return val.text ?? '';
    }
  }
  return val;
}

/**
 * Parses numeric value safely, rejecting NaN, Infinity, and negative values.
 * Automatically sanitizes currency formatting (₹, $, commas, whitespace).
 */
function parseNonNegativeNumber(val, fieldName, rowNumber) {
  const prefix = rowNumber ? `Row ${rowNumber}: ` : '';
  if (val === '' || val === null || val === undefined) {
    return { error: `${prefix}${fieldName} is required.` };
  }

  let cleanVal = val;
  if (typeof cleanVal === 'string') {
    cleanVal = cleanVal.replace(/[₹$,\s]/g, '').trim();
    if (cleanVal === '') {
      return { error: `${prefix}${fieldName} is required.` };
    }
  }

  const num = Number(cleanVal);
  if (isNaN(num) || !isFinite(num)) {
    return { error: `${prefix}${fieldName} must be a valid numeric value.` };
  }
  if (num < 0) {
    return { error: `${prefix}${fieldName} cannot be negative.` };
  }
  return { value: Math.round(num * 100) / 100 };
}

/**
 * Parses month value supporting numbers (1-12) or month names ('September', etc.).
 */
function parseMonthValue(rawMonth, rowNumber) {
  const prefix = rowNumber ? `Row ${rowNumber}: ` : '';
  if (rawMonth === '' || rawMonth === null || rawMonth === undefined) {
    return { error: `${prefix}Month is required.` };
  }

  const str = String(rawMonth).trim();
  const m = parseInt(str, 10);
  if (!isNaN(m) && m >= 1 && m <= 12) {
    return { value: m };
  }

  const idx = MONTH_NAMES.findIndex((name) => name.toLowerCase() === str.toLowerCase());
  if (idx !== -1) {
    return { value: idx + 1 };
  }

  const abbrIdx = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(str.toLowerCase().slice(0, 3)));
  if (abbrIdx !== -1) {
    return { value: abbrIdx + 1 };
  }

  return { error: `${prefix}Month must be an integer between 1 and 12.` };
}

/**
 * Parses 4-digit calendar year value (2000 - 2100).
 */
function parseYearValue(rawYear, rowNumber) {
  const prefix = rowNumber ? `Row ${rowNumber}: ` : '';
  if (rawYear === '' || rawYear === null || rawYear === undefined) {
    return { error: `${prefix}Year is required.` };
  }

  const y = parseInt(String(rawYear).trim(), 10);
  if (isNaN(y) || y < 2000 || y > 2100) {
    return { error: `${prefix}Year must be an integer between 2000 and 2100.` };
  }

  return { value: y };
}

/**
 * Generates the official, styled Excel payroll template workbook.
 */
async function generateTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GaintPro Software Technologies';
  workbook.lastModifiedBy = 'GaintPro Payroll System';
  workbook.created = new Date();
  workbook.modified = new Date();

  // 1. Data Sheet
  const sheet = workbook.addWorksheet('Payroll_Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Employee ID', key: 'employee_id', width: 16 },
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Working Days', key: 'working_days', width: 15 },
    { header: 'Payable Days', key: 'payable_days', width: 15 },
    { header: 'Basic Salary', key: 'basic_salary', width: 16 },
    { header: 'HRA', key: 'hra', width: 14 },
    { header: 'Allowances', key: 'allowances', width: 15 },
    { header: 'PF Employee', key: 'pf_employee', width: 15 },
    { header: 'Professional Tax', key: 'professional_tax', width: 18 },
    { header: 'Other Deductions', key: 'other_deductions', width: 18 },
  ];

  // Header row styling
  const headerRow = sheet.getRow(1);
  headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Dark slate
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 26;

  // 2. Sample Data Sheet
  const sampleSheet = workbook.addWorksheet('Sample_Data');
  sampleSheet.columns = sheet.columns;
  const sampleHeader = sampleSheet.getRow(1);
  sampleHeader.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  sampleHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF334155' },
  };
  sampleHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  sampleHeader.height = 26;

  sampleSheet.addRow({
    employee_id: 'GP0001N',
    month: 9,
    year: 2026,
    working_days: 26,
    payable_days: 26,
    basic_salary: 30000,
    hra: 5000,
    allowances: 5000,
    pf_employee: 1800,
    professional_tax: 200,
    other_deductions: 500,
  });

  // 3. Instructions Sheet
  const instrSheet = workbook.addWorksheet('Instructions');
  instrSheet.columns = [
    { header: 'Field / Rule', key: 'field', width: 22 },
    { header: 'Description & Validation Constraints', key: 'desc', width: 70 },
  ];

  const instrHeader = instrSheet.getRow(1);
  instrHeader.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F766E' }, // Teal
  };
  instrHeader.height = 26;

  const instructions = [
    { field: 'Employee ID', desc: 'Must match an existing ACTIVE employee in the portal (e.g. GP0001N). Cannot be empty.' },
    { field: 'Month', desc: 'Numeric month number between 1 (January) and 12 (December) or month name.' },
    { field: 'Year', desc: '4-digit calendar year between 2000 and 2100 (e.g. 2026).' },
    { field: 'Working Days', desc: 'Total standard working days in the month (e.g. 26). Must be >= 0.' },
    { field: 'Payable Days', desc: 'Days payable for this employee. Cannot exceed Working Days (Payable Days <= Working Days).' },
    { field: 'Basic Salary', desc: 'Monthly basic salary in INR. Numeric non-negative value (>= 0).' },
    { field: 'HRA', desc: 'House Rent Allowance in INR. Numeric non-negative value (>= 0).' },
    { field: 'Allowances', desc: 'Special & other allowances in INR. Numeric non-negative value (>= 0).' },
    { field: 'PF Employee', desc: 'Employee provident fund contribution deduction. Numeric non-negative (>= 0).' },
    { field: 'Professional Tax', desc: 'Applicable state professional tax. Numeric non-negative (>= 0).' },
    { field: 'Other Deductions', desc: 'Any other authorized deductions. Numeric non-negative (>= 0).' },
    { field: 'Server Calculation', desc: 'Gross Salary, Total Deductions, and Net Salary are strictly calculated by the server.' },
    { field: 'Duplicate Rule', desc: 'Only one payroll record per Employee ID + Month + Year is allowed.' },
    { field: 'Import Modes', desc: 'CREATE ONLY (default, rejects if payroll exists) or UPDATE EXISTING (updates existing record).' },
  ];

  instructions.forEach((i) => instrSheet.addRow(i));
  instrSheet.views = [{ state: 'frozen', ySplit: 1 }];

  return workbook;
}

/**
 * Generates an official, downloadable processing / error report in Excel (.xlsx) format.
 *
 * @param {Object} reportData
 * @param {string} reportData.batchNumber
 * @param {number} reportData.month
 * @param {number} reportData.year
 * @param {string} reportData.status
 * @param {string} [reportData.adminName]
 * @param {Object} reportData.summary
 * @param {Array<Object>} reportData.rows
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function generateProcessingReportWorkbook(reportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GaintPro Software Technologies';
  workbook.lastModifiedBy = 'GaintPro HRM Payroll System';
  workbook.created = new Date();

  const monthName = MONTH_NAMES[(reportData.month || 1) - 1] || reportData.month;
  const periodLabel = `${monthName} ${reportData.year || ''}`;

  // 1. Summary Sheet
  const summarySheet = workbook.addWorksheet('Batch_Summary');
  summarySheet.views = [{ showGridLines: true }];

  summarySheet.columns = [
    { width: 28 },
    { width: 36 },
  ];

  const addSummaryRow = (label, value, isBold = false) => {
    const row = summarySheet.addRow([label, value]);
    if (isBold) {
      row.font = { bold: true };
    }
  };

  summarySheet.mergeCells('A1:B1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'GAINTPRO SOFTWARE TECHNOLOGIES — PAYROLL PROCESSING REPORT';
  titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 32;

  summarySheet.addRow([]);
  addSummaryRow('Batch Number', reportData.batchNumber || 'N/A', true);
  addSummaryRow('Payroll Period', periodLabel, true);
  addSummaryRow('Batch Status', reportData.status || 'Processed', true);
  addSummaryRow('Generated At', new Date().toISOString());
  addSummaryRow('Admin / Processed By', reportData.adminName || 'Authorized Administrator');
  summarySheet.addRow([]);

  const summary = reportData.summary || {};
  addSummaryRow('Total Records in Batch', summary.totalRows || summary.totalRecords || 0, true);
  addSummaryRow('Valid Records', summary.validRows || summary.validRecords || 0);
  addSummaryRow('Invalid Records', summary.invalidRows || summary.invalidRecords || 0);
  addSummaryRow('Successfully Processed Records', summary.processedRecords || summary.createdCount || 0);
  addSummaryRow('Payslips Generated', summary.payslipsGenerated || 0);
  addSummaryRow('Payslips Failed', summary.payslipsFailed || 0);
  summarySheet.addRow([]);

  addSummaryRow('Total Gross Salary (INR)', `₹${Number(summary.totalGrossSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, true);
  addSummaryRow('Total Deductions (INR)', `₹${Number(summary.totalDeductions || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, true);
  addSummaryRow('Total Net Salary Payable (INR)', `₹${Number(summary.totalNetSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, true);

  // 2. Employee Details Sheet
  const detailsSheet = workbook.addWorksheet('Employee_Details', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
  });

  detailsSheet.columns = [
    { header: 'Row #', key: 'rowNumber', width: 10 },
    { header: 'Employee ID', key: 'employee_id', width: 16 },
    { header: 'Employee Name', key: 'employee_name', width: 24 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Month', key: 'month', width: 10 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Working Days', key: 'working_days', width: 14 },
    { header: 'Payable Days', key: 'payable_days', width: 14 },
    { header: 'Basic Salary', key: 'basic_salary', width: 15 },
    { header: 'HRA', key: 'hra', width: 14 },
    { header: 'Allowances', key: 'allowances', width: 15 },
    { header: 'Gross Salary', key: 'gross_salary', width: 16 },
    { header: 'PF Employee', key: 'pf_employee', width: 15 },
    { header: 'Professional Tax', key: 'professional_tax', width: 16 },
    { header: 'Other Deductions', key: 'other_deductions', width: 16 },
    { header: 'Total Deductions', key: 'total_deductions', width: 16 },
    { header: 'Net Salary', key: 'net_salary', width: 16 },
    { header: 'Validation Status', key: 'status', width: 18 },
    { header: 'Payslip Status', key: 'payslip_status', width: 18 },
    { header: 'Validation Errors / Remarks', key: 'errors', width: 40 },
  ];

  const headerRow = detailsSheet.getRow(1);
  headerRow.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  headerRow.height = 24;

  const rows = reportData.rows || [];
  rows.forEach((r, idx) => {
    const errorStr = Array.isArray(r.errors) ? r.errors.join(' | ') : (r.errors || r.issue || '-');
    const dRow = detailsSheet.addRow({
      rowNumber: r.rowNumber || idx + 2,
      employee_id: r.employee_id || r.employeeId,
      employee_name: r.employee_name || r.name || '-',
      department: r.department || '-',
      month: r.month,
      year: r.year,
      working_days: r.working_days,
      payable_days: r.payable_days,
      basic_salary: r.basic_salary,
      hra: r.hra,
      allowances: r.allowances,
      gross_salary: r.gross_salary,
      pf_employee: r.pf_employee,
      professional_tax: r.professional_tax,
      other_deductions: r.other_deductions,
      total_deductions: r.total_deductions,
      net_salary: r.net_salary,
      status: r.status,
      payslip_status: r.payslip_status || (r.status === 'VALID' ? 'Generated' : 'Skipped'),
      errors: errorStr,
    });

    if (r.status === 'INVALID' || r.status === 'Error') {
      dRow.getCell('status').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEE2E2' },
      };
      dRow.getCell('status').font = { color: { argb: 'FFDC2626' }, bold: true };
    }
  });

  return workbook;
}

/**
 * Parses and validates an uploaded Excel buffer.
 * Performs deep schema checks, PostgreSQL employee validation, duplicate checks,
 * existing record checks, and server-side preview calculations.
 *
 * @param {Buffer} buffer Excel file buffer
 * @param {Object} pool PostgreSQL connection pool
 * @returns {Promise<Object>} Preview summary and validated row list
 */
async function parseAndValidateExcelBuffer(buffer, pool) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // 1. Select the target data worksheet
  let sheet = workbook.getWorksheet('Payroll_Data') || workbook.getWorksheet('Payroll Data');
  if (!sheet) {
    sheet = workbook.worksheets[0];
  }

  if (!sheet || sheet.rowCount < 1) {
    const error = new Error('Uploaded Excel file contains no worksheets or data.');
    error.statusCode = 400;
    throw error;
  }

  // 2. Identify and validate header row
  const headerRow = sheet.getRow(1);
  const headerMap = {}; // normalKey -> colIndex (1-based)
  const missingHeaders = [];

  headerRow.eachCell((cell, colNumber) => {
    const rawText = String(getCellValue(cell)).trim();
    const normalized = normalizeHeader(rawText);

    for (const exp of EXPECTED_COLUMNS) {
      if (exp.aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        headerMap[exp.key] = colNumber;
        break;
      }
    }
  });

  // Verify all required columns are present
  for (const exp of EXPECTED_COLUMNS) {
    if (!headerMap[exp.key]) {
      missingHeaders.push(exp.label);
    }
  }

  if (missingHeaders.length > 0) {
    const error = new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    error.statusCode = 400;
    error.missingHeaders = missingHeaders;
    throw error;
  }

  // 3. Parse all rows
  const parsedRows = [];
  const rawEmployeeIds = new Set();
  const seenInBatch = new Set();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    // Read values
    const getVal = (key) => getCellValue(row.getCell(headerMap[key]));

    const rawEmpId = String(getVal('employee_id') || '').trim();
    const rawMonth = getVal('month');
    const rawYear = getVal('year');
    const rawWorkingDays = getVal('working_days');
    const rawPayableDays = getVal('payable_days');
    const rawBasic = getVal('basic_salary');
    const rawHra = getVal('hra');
    const rawAllowances = getVal('allowances');
    const rawPf = getVal('pf_employee');
    const rawPt = getVal('professional_tax');
    const rawOther = getVal('other_deductions');

    // Skip entirely blank rows
    const isRowEmpty =
      !rawEmpId &&
      rawMonth === '' &&
      rawYear === '' &&
      rawBasic === '' &&
      rawPayableDays === '';
    if (isRowEmpty) return;

    // Skip sample rows if marked
    if (rawEmpId.toUpperCase().includes('SAMPLE')) {
      return;
    }

    const rowErrors = [];

    // Validate Employee ID
    if (!rawEmpId) {
      rowErrors.push(`Row ${rowNumber}: Employee ID cannot be empty.`);
    } else if (rawEmpId.length > 50) {
      rowErrors.push(`Row ${rowNumber}: Employee ID exceeds maximum length (50 characters).`);
    }

    // Validate Month
    let monthNum = null;
    const monthRes = parseMonthValue(rawMonth, rowNumber);
    if (monthRes.error) {
      rowErrors.push(monthRes.error);
    } else {
      monthNum = monthRes.value;
    }

    // Validate Year
    let yearNum = null;
    const yearRes = parseYearValue(rawYear, rowNumber);
    if (yearRes.error) {
      rowErrors.push(yearRes.error);
    } else {
      yearNum = yearRes.value;
    }

    // Validate Working Days
    const wdRes = parseNonNegativeNumber(rawWorkingDays, 'Working Days', rowNumber);
    if (wdRes.error) rowErrors.push(wdRes.error);
    const workingDays = wdRes.value ?? 0;

    // Validate Payable Days
    const pdRes = parseNonNegativeNumber(rawPayableDays, 'Payable Days', rowNumber);
    if (pdRes.error) rowErrors.push(pdRes.error);
    const payableDays = pdRes.value ?? 0;

    if (!wdRes.error && !pdRes.error) {
      if (payableDays > workingDays) {
        rowErrors.push(`Row ${rowNumber}: Payable Days (${payableDays}) cannot exceed Working Days (${workingDays}).`);
      }
    }

    // Validate Basic Salary
    const basicRes = parseNonNegativeNumber(rawBasic, 'Basic Salary', rowNumber);
    if (basicRes.error) rowErrors.push(basicRes.error);
    const basicSalary = basicRes.value ?? 0;

    // Validate HRA
    const hraRes = parseNonNegativeNumber(rawHra, 'HRA', rowNumber);
    if (hraRes.error) rowErrors.push(hraRes.error);
    const hra = hraRes.value ?? 0;

    // Validate Allowances
    const allowRes = parseNonNegativeNumber(rawAllowances, 'Allowances', rowNumber);
    if (allowRes.error) rowErrors.push(allowRes.error);
    const allowances = allowRes.value ?? 0;

    // Validate PF
    const pfRes = parseNonNegativeNumber(rawPf, 'PF Employee', rowNumber);
    if (pfRes.error) rowErrors.push(pfRes.error);
    const pfEmployee = pfRes.value ?? 0;

    // Validate PT
    const ptRes = parseNonNegativeNumber(rawPt, 'Professional Tax', rowNumber);
    if (ptRes.error) rowErrors.push(ptRes.error);
    const professionalTax = ptRes.value ?? 0;

    // Validate Other Deductions
    const otherRes = parseNonNegativeNumber(rawOther, 'Other Deductions', rowNumber);
    if (otherRes.error) rowErrors.push(otherRes.error);
    const otherDeductions = otherRes.value ?? 0;

    // Duplicate check within batch
    let isDuplicateInBatch = false;
    if (rawEmpId && monthNum && yearNum) {
      const batchKey = `${rawEmpId.toUpperCase()}_${monthNum}_${yearNum}`;
      if (seenInBatch.has(batchKey)) {
        isDuplicateInBatch = true;
        rowErrors.push(`Row ${rowNumber}: Duplicate row in Excel for employee ${rawEmpId} in period ${monthNum}/${yearNum}.`);
      } else {
        seenInBatch.add(batchKey);
      }
    }

    // Calculations performed strictly on the server
    const grossSalary = Math.round((basicSalary + hra + allowances) * 100) / 100;
    const totalDeductions = Math.round((pfEmployee + professionalTax + otherDeductions) * 100) / 100;
    const netSalary = Math.round((grossSalary - totalDeductions) * 100) / 100;

    if (rawEmpId) {
      rawEmployeeIds.add(rawEmpId);
    }

    parsedRows.push({
      rowNumber,
      employee_id: rawEmpId,
      employee_name: '', // Will be filled from DB
      month: monthNum,
      year: yearNum,
      working_days: workingDays,
      payable_days: payableDays,
      basic_salary: basicSalary,
      hra,
      allowances,
      gross_salary: grossSalary,
      pf_employee: pfEmployee,
      professional_tax: professionalTax,
      other_deductions: otherDeductions,
      total_deductions: totalDeductions,
      net_salary: netSalary,
      status: rowErrors.length === 0 ? 'VALID' : 'INVALID',
      isDuplicateInBatch,
      existsInDb: false,
      errors: rowErrors,
    });
  });

  if (parsedRows.length === 0) {
    const error = new Error('No payroll data rows found in the uploaded workbook.');
    error.statusCode = 400;
    throw error;
  }

  // 4. Batch query PostgreSQL for employee existence and status
  const empIdsArray = Array.from(rawEmployeeIds);
  const empRes = await pool.query(
    `SELECT employee_id, first_name, last_name, department, designation, status 
     FROM public.employees 
     WHERE employee_id = ANY($1::varchar[])`,
    [empIdsArray]
  );

  const employeeMap = new Map();
  empRes.rows.forEach((e) => {
    employeeMap.set(e.employee_id.toUpperCase(), e);
  });

  // 5. Batch query PostgreSQL for existing payroll records in this period
  const yearsInBatch = Array.from(new Set(parsedRows.map((r) => r.year).filter(Boolean)));
  const existingPayrollMap = new Set();

  if (yearsInBatch.length > 0 && empIdsArray.length > 0) {
    const existingRes = await pool.query(
      `SELECT employee_id, month, year 
       FROM public.payroll_records 
       WHERE employee_id = ANY($1::varchar[]) 
         AND year = ANY($2::int[])`,
      [empIdsArray, yearsInBatch]
    );

    existingRes.rows.forEach((r) => {
      existingPayrollMap.add(`${r.employee_id.toUpperCase()}_${r.month}_${r.year}`);
    });
  }

  // 6. Enrich parsed rows with DB validation results
  let validRowsCount = 0;
  let invalidRowsCount = 0;
  let existingPayrollCount = 0;
  let duplicateCount = 0;

  let totalGrossSalary = 0;
  let totalDeductions = 0;
  let totalNetSalary = 0;

  parsedRows.forEach((row) => {
    const empRecord = employeeMap.get(row.employee_id.toUpperCase());

    if (!empRecord) {
      row.status = 'INVALID';
      row.errors.push(`Row ${row.rowNumber}: Employee ID '${row.employee_id}' does not exist in the HRM database.`);
    } else {
      row.employee_name = `${empRecord.first_name} ${empRecord.last_name}`.trim();
      row.department = empRecord.department;
      row.designation = empRecord.designation;

      if (empRecord.status && empRecord.status !== 'ACTIVE') {
        row.errors.push(`Row ${row.rowNumber}: Employee '${row.employee_id}' is inactive (status: ${empRecord.status}).`);
        row.status = 'INVALID';
      }
    }

    if (row.isDuplicateInBatch) {
      row.status = 'INVALID';
      duplicateCount++;
    }

    // Check existing payroll record in database
    if (row.month && row.year) {
      const dbKey = `${row.employee_id.toUpperCase()}_${row.month}_${row.year}`;
      if (existingPayrollMap.has(dbKey)) {
        row.existsInDb = true;
        existingPayrollCount++;
      }
    }

    if (row.errors.length > 0) {
      row.status = 'INVALID';
      invalidRowsCount++;
    } else {
      row.status = 'VALID';
      validRowsCount++;

      totalGrossSalary += row.gross_salary;
      totalDeductions += row.total_deductions;
      totalNetSalary += row.net_salary;
    }
  });

  const batchMonth = parsedRows.find((r) => r.month)?.month || null;
  const batchYear = parsedRows.find((r) => r.year)?.year || null;

  const summary = {
    totalRows: parsedRows.length,
    validRows: validRowsCount,
    invalidRows: invalidRowsCount,
    existingPayrollRows: existingPayrollCount,
    duplicateRows: duplicateCount,
    totalGrossSalary: Math.round(totalGrossSalary * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    totalNetSalary: Math.round(totalNetSalary * 100) / 100,
    month: batchMonth,
    year: batchYear,
  };

  const importId = saveImportSession({
    summary,
    rows: parsedRows,
  });

  return {
    importId,
    summary,
    rows: parsedRows,
  };
}

module.exports = {
  EXPECTED_COLUMNS,
  MONTH_NAMES,
  generateTemplateWorkbook,
  generateProcessingReportWorkbook,
  parseAndValidateExcelBuffer,
  parseNonNegativeNumber,
  parseMonthValue,
  parseYearValue,
  saveImportSession,
  getImportSession,
  deleteImportSession,
};
