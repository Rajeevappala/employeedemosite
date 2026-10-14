const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

let pool = null;
try {
  pool = require('../config/database');
} catch (_) {
  // DB connection optional for unit tests
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Custom error thrown when official payslip generation cannot proceed
 * due to missing or unreadable company authorization assets.
 */
class MissingPayslipAssetsError extends Error {
  constructor(message, missingDetails = []) {
    super(message);
    this.name = 'MissingPayslipAssetsError';
    this.code = 'MISSING_AUTHORIZATION_ASSETS';
    this.statusCode = 422;
    this.missingDetails = missingDetails;
  }
}

/**
 * Returns absolute filesystem paths for the company authorization assets.
 * Allows override via environment variables COMPANY_SIGNATURE_PATH and COMPANY_STAMP_PATH.
 * Defaults to secure, non-public directory: Backend/assets/company/
 */
function getAuthorizationAssetPaths() {
  const defaultSig = path.join(__dirname, '..', 'assets', 'company', 'signatory_signature.png');
  const defaultStamp = path.join(__dirname, '..', 'assets', 'company', 'office_stamp.png');

  const signaturePath = process.env.COMPANY_SIGNATURE_PATH
    ? (path.isAbsolute(process.env.COMPANY_SIGNATURE_PATH)
        ? process.env.COMPANY_SIGNATURE_PATH
        : path.resolve(process.cwd(), process.env.COMPANY_SIGNATURE_PATH))
    : defaultSig;

  const stampPath = process.env.COMPANY_STAMP_PATH
    ? (path.isAbsolute(process.env.COMPANY_STAMP_PATH)
        ? process.env.COMPANY_STAMP_PATH
        : path.resolve(process.cwd(), process.env.COMPANY_STAMP_PATH))
    : defaultStamp;

  return { signaturePath, stampPath };
}

/**
 * Resolves the filesystem path to the official GaintPro company logo.
 * Supports environment variable COMPANY_LOGO_PATH or local project assets.
 */
function getCompanyLogoPath() {
  const configured = process.env.COMPANY_LOGO_PATH;
  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
    if (fs.existsSync(resolved)) return resolved;
  }

  // 1. Primary local backend asset (png)
  const primary = path.join(__dirname, '..', 'assets', 'company', 'gaintpro-logo.png');
  if (fs.existsSync(primary)) return primary;

  // 2. Primary local backend asset (jpg)
  const primaryJpg = path.join(__dirname, '..', 'assets', 'company', 'gaintpro-logo.jpg');
  if (fs.existsSync(primaryJpg)) return primaryJpg;

  // 3. Fallback to Frontend local assets if present
  const frontendAsset = path.join(__dirname, '..', '..', 'Frontend', 'src', 'assets', 'gaintpro-logo.png');
  if (fs.existsSync(frontendAsset)) return frontendAsset;

  return null;
}

/**
 * Inspects and validates the presence, readability, and non-empty status
 * of the required company authorization assets (signature and stamp).
 *
 * @returns {Object} Validation summary with status flags and missing item details
 */
function checkAuthorizationAssets() {
  const { signaturePath, stampPath } = getAuthorizationAssetPaths();
  const missing = [];

  let signatureValid = false;
  let stampValid = false;
  let signatureSize = 0;
  let stampSize = 0;

  // 1. Signature inspection
  if (fs.existsSync(signaturePath)) {
    try {
      fs.accessSync(signaturePath, fs.constants.R_OK);
      const stat = fs.statSync(signaturePath);
      if (stat.size > 0) {
        signatureValid = true;
        signatureSize = stat.size;
      } else {
        missing.push({
          type: 'signature',
          label: 'Authorized Signatory Signature',
          path: signaturePath,
          reason: 'File exists but is empty (0 bytes)',
        });
      }
    } catch (err) {
      missing.push({
        type: 'signature',
        label: 'Authorized Signatory Signature',
        path: signaturePath,
        reason: `File cannot be read: ${err.message}`,
      });
    }
  } else {
    missing.push({
      type: 'signature',
      label: 'Authorized Signatory Signature',
      path: signaturePath,
      reason: 'File not found at configured path',
    });
  }

  // 2. Stamp inspection
  if (fs.existsSync(stampPath)) {
    try {
      fs.accessSync(stampPath, fs.constants.R_OK);
      const stat = fs.statSync(stampPath);
      if (stat.size > 0) {
        stampValid = true;
        stampSize = stat.size;
      } else {
        missing.push({
          type: 'stamp',
          label: 'Official Company Office Stamp',
          path: stampPath,
          reason: 'File exists but is empty (0 bytes)',
        });
      }
    } catch (err) {
      missing.push({
        type: 'stamp',
        label: 'Official Company Office Stamp',
        path: stampPath,
        reason: `File cannot be read: ${err.message}`,
      });
    }
  } else {
    missing.push({
      type: 'stamp',
      label: 'Official Company Office Stamp',
      path: stampPath,
      reason: 'File not found at configured path',
    });
  }

  return {
    isComplete: signatureValid && stampValid,
    signatureValid,
    stampValid,
    signaturePath,
    stampPath,
    signatureSize,
    stampSize,
    missing,
  };
}

/**
 * Formats a numeric currency value into consistent Indian Rupee format
 * e.g. ₹25,000.00, ₹15,000.00, ₹30,000.00, and -₹2,500.00 for negative deductions.
 *
 * @param {number|string} val
 * @returns {string}
 */
function formatINR(val) {
  const num = typeof val === 'number' ? val : parseFloat(val) || 0;
  const isNegative = num < 0;
  const formatted = Math.abs(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}₹${formatted}`;
}

/**
 * Returns month name string for integer month (1 - 12).
 */
function getMonthName(monthNumber) {
  if (typeof monthNumber === 'number' && monthNumber >= 1 && monthNumber <= 12) {
    return MONTH_NAMES[monthNumber - 1];
  }
  return String(monthNumber || '');
}

/**
 * Safely formats date string or Date object to DD-MMM-YYYY (e.g. 01-Jan-2024).
 */
function formatDate(dateInput) {
  if (!dateInput) return 'Not configured';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const day = String(d.getDate()).padStart(2, '0');
    const month = MONTH_NAMES[d.getMonth()] ? MONTH_NAMES[d.getMonth()].slice(0, 3) : 'Jan';
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return 'Not configured';
  }
}

/**
 * Converts numeric amount into Indian numbering English words
 * (e.g. 37500 -> "Thirty Seven Thousand Five Hundred Rupees Only")
 */
function numberToWordsINR(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  if (isNaN(num)) return 'Zero Rupees Only';

  const absNum = Math.abs(num);
  const rupees = Math.floor(absNum);
  const paise = Math.round((absNum - rupees) * 100);

  if (rupees === 0 && paise === 0) {
    return 'Zero Rupees Only';
  }

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertTwoDigits(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o > 0 ? ' ' + ones[o] : '');
  }

  function convertThreeDigits(n) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    let res = '';
    if (h > 0) {
      res += ones[h] + ' Hundred';
      if (r > 0) res += ' ';
    }
    if (r > 0) {
      res += convertTwoDigits(r);
    }
    return res;
  }

  const crore = Math.floor(rupees / 10000000);
  let rem = rupees % 10000000;
  const lakh = Math.floor(rem / 100000);
  rem = rem % 100000;
  const thousand = Math.floor(rem / 1000);
  rem = rem % 1000;
  const hundredAndBelow = rem;

  const words = [];
  if (crore > 0) words.push(convertThreeDigits(crore) + ' Crore');
  if (lakh > 0) words.push(convertTwoDigits(lakh) + ' Lakh');
  if (thousand > 0) words.push(convertTwoDigits(thousand) + ' Thousand');
  if (hundredAndBelow > 0) words.push(convertThreeDigits(hundredAndBelow));

  let result = words.length > 0 ? words.join(' ') + ' Rupees' : '';
  if (paise > 0) {
    const paiseWords = convertTwoDigits(paise) + ' Paise';
    if (result) {
      result += ' and ' + paiseWords;
    } else {
      result = paiseWords;
    }
  }

  return (result + ' Only').trim();
}

/**
 * Registers bundled Unicode fonts in PDFKit to guarantee native rendering
 * of the Indian Rupee symbol (₹ / U+20B9) across all PDF viewers and operating systems.
 *
 * @param {PDFDocument} doc
 * @returns {Object} Registered font names { regularFont: string, boldFont: string }
 */
function configurePdfFonts(doc) {
  const regularFontPath = process.env.FONT_NOTO_SANS_REGULAR ||
    path.join(__dirname, '..', 'assets', 'fonts', 'NotoSans-Regular.ttf');
  const boldFontPath = process.env.FONT_NOTO_SANS_BOLD ||
    path.join(__dirname, '..', 'assets', 'fonts', 'NotoSans-Bold.ttf');

  let regularFont = 'Helvetica';
  let boldFont = 'Helvetica-Bold';

  if (fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath)) {
    try {
      doc.registerFont('NotoSans', regularFontPath);
      doc.registerFont('NotoSans-Bold', boldFontPath);
      regularFont = 'NotoSans';
      boldFont = 'NotoSans-Bold';
    } catch (fontErr) {
      console.warn('Failed to register NotoSans fonts in PDFKit, falling back to standard fonts:', fontErr.message);
    }
  } else {
    console.warn(`Unicode font files not found at ${regularFontPath} / ${boldFontPath}. Rupee glyph may not render correctly.`);
  }

  return { regularFont, boldFont };
}

/**
 * Enriches payslip data with database records if not already supplied.
 * Gracefully defaults if database is not reachable.
 */
async function enrichPayslipData({ employee, payroll, pfDetails, bankDetails }) {
  const enriched = {
    employee: { ...employee },
    payroll: { ...payroll },
    pfDetails: pfDetails ? { ...pfDetails } : null,
    bankDetails: bankDetails ? { ...bankDetails } : null,
    companyAddress: 'Plot 42, Hitech City Phase 2, Cyber Towers 5th Floor, Hyderabad, Telangana - 500081, India',
    companyLegalName: 'GaintPro Software Technologies Private Limited',
  };

  if (!pool || !employee?.employee_id) {
    return enriched;
  }

  try {
    const empId = employee.employee_id;

    // 1. Enrich employee fields if date_of_joining or work_location missing
    if (!enriched.employee.date_of_joining || !enriched.employee.work_location) {
      const empRes = await pool.query(
        `SELECT date_of_joining, work_location, first_name, last_name, designation, department, status
         FROM public.employees
         WHERE employee_id = $1 LIMIT 1`,
        [empId]
      );
      if (empRes.rows.length > 0) {
        const dbEmp = empRes.rows[0];
        if (!enriched.employee.date_of_joining) enriched.employee.date_of_joining = dbEmp.date_of_joining;
        if (!enriched.employee.work_location) enriched.employee.work_location = dbEmp.work_location;
        if (!enriched.employee.first_name) enriched.employee.first_name = dbEmp.first_name;
        if (!enriched.employee.last_name) enriched.employee.last_name = dbEmp.last_name;
        if (!enriched.employee.designation) enriched.employee.designation = dbEmp.designation;
        if (!enriched.employee.department) enriched.employee.department = dbEmp.department;
      }
    }

    // 2. Enrich Bank Details if not provided
    if (!enriched.bankDetails) {
      const bankRes = await pool.query(
        `SELECT bank_name, account_number_last4, branch_name, ifsc_code, account_type
         FROM public.employee_bank_details
         WHERE employee_id = $1 LIMIT 1`,
        [empId]
      );
      if (bankRes.rows.length > 0) {
        enriched.bankDetails = bankRes.rows[0];
      }
    }

    // 3. Enrich PF Details if not provided
    if (!enriched.pfDetails) {
      const pfRes = await pool.query(
        `SELECT uan_number, pf_number
         FROM public.pf_details
         WHERE employee_id = $1 LIMIT 1`,
        [empId]
      );
      if (pfRes.rows.length > 0) {
        enriched.pfDetails = pfRes.rows[0];
      }
    }

    // 4. Enrich Organization Settings
    const orgRes = await pool.query(
      `SELECT legal_name, organization_name, address_line_1, address_line_2, city, state, postal_code, country
       FROM public.organization_settings LIMIT 1`
    );
    if (orgRes.rows.length > 0) {
      const org = orgRes.rows[0];
      if (org.legal_name) enriched.companyLegalName = org.legal_name;
      const addrParts = [
        org.address_line_1,
        org.address_line_2,
        org.city,
        `${org.state}${org.postal_code ? ' - ' + org.postal_code : ''}`,
        org.country,
      ].filter(Boolean);
      if (addrParts.length > 0) {
        enriched.companyAddress = addrParts.join(', ');
      }
    }
  } catch (_) {
    // Graceful fallback to default/passed values
  }

  return enriched;
}

/**
 * Generates a clean, professional corporate payslip PDF buffer.
 *
 * Traditional Corporate Layout:
 * - A4 portrait page layout, print-friendly white background with black text and thin 0.5pt black borders.
 * - Formal header with official GaintPro logo, registered company address, and clear PAYSLIP title.
 * - Compact 4-column bordered employee information table with actual values and 'Not configured' fallbacks.
 * - Side-by-side bordered Earnings and Deductions tables with right-aligned Indian Rupee figures.
 * - Prominent summary displaying Gross Earnings, Total Deductions, Net Pay, and exact Amount in Words.
 * - Full Unicode font embedding (Noto Sans) for pristine ₹ (U+20B9) rendering.
 * - Automated loading and aspect-ratio-preserved embedding of genuine company signature and office stamp.
 * - Subtle GaintPro watermark and confidentiality footer notice.
 *
 * @param {Object} params
 * @param {Object} params.employee Employee record from public.employees
 * @param {Object} params.payroll Finalized payroll record from public.payroll_records
 * @param {Object} [params.pfDetails] Optional PF details from public.pf_details
 * @param {Object} [params.bankDetails] Optional bank details from public.employee_bank_details
 * @param {boolean} [params.isPreview=false] When true, allows generating preview draft layout even if real assets are missing
 * @param {boolean} [params.requireAssets] Override whether genuine assets are strictly required
 * @returns {Promise<Buffer>} Resolves to the generated PDF buffer
 */
async function generatePayslipPdf({ employee, payroll, pfDetails, bankDetails, isPreview = false, requireAssets }) {
  const assetStatus = checkAuthorizationAssets();
  const shouldStrictlyRequireAssets = typeof requireAssets === 'boolean'
    ? requireAssets
    : (!isPreview && process.env.PAYSLIP_REQUIRE_ASSETS === 'true');

  if (shouldStrictlyRequireAssets && !assetStatus.isComplete) {
    const missingLabels = assetStatus.missing.map(m => `${m.label} (${m.reason}: ${m.path})`).join('; ');
    throw new MissingPayslipAssetsError(
      `Official payslip cannot be generated: Required company authorization asset(s) are missing or unreadable. [${missingLabels}]. Please configure genuine PNG assets before issuing official signed payslips.`,
      assetStatus.missing
    );
  }

  // Enrich data from database if available
  const data = await enrichPayslipData({ employee, payroll, pfDetails, bankDetails });
  const emp = data.employee;
  const pay = data.payroll;
  const pf = data.pfDetails;
  const bank = data.bankDetails;

  return new Promise((resolve, reject) => {
    try {
      const monthStr = getMonthName(pay.month);
      const periodStr = `${monthStr} ${pay.year}`;
      const employeeId = emp.employee_id || pay.employee_id || 'Not configured';

      const doc = new PDFDocument({
        size: 'A4',
        margin: 36,
        compress: false,
        info: {
          Title: `Payslip - ${employeeId} - ${periodStr}`,
          Author: 'GaintPro Software Technologies Private Limited',
          Subject: 'Monthly Salary Payslip',
          Creator: 'GaintPro Payroll System',
        },
      });

      const { regularFont, boldFont } = configurePdfFonts(doc);

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on('error', (err) => reject(err));

      const pageWidth = doc.page.width; // 595.28
      const pageHeight = doc.page.height; // 841.89
      const margin = 36;
      const contentWidth = pageWidth - margin * 2; // 523.28

      // =======================================================================
      // 0. SUBTLE WATERMARK (Rendered in background before foreground text)
      // =======================================================================
      const logoPath = getCompanyLogoPath();
      if (logoPath && fs.existsSync(logoPath)) {
        try {
          doc.save();
          doc.opacity(0.04);
          const wmWidth = 260;
          const wmX = (pageWidth - wmWidth) / 2;
          const wmY = (pageHeight - 120) / 2;
          doc.image(logoPath, wmX, wmY, { width: wmWidth, align: 'center' });
          doc.restore();
        } catch (_) {
          // Watermark non-fatal
        }
      }

      let y = 30;

      // =======================================================================
      // 1. COMPANY HEADER (Logo, Company Name, Official Registered Address)
      // =======================================================================
      let logoRendered = false;
      if (logoPath && fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, margin, y, {
            fit: [125, 48],
            align: 'left',
            valign: 'center',
          });
          logoRendered = true;
        } catch (logoErr) {
          console.error(`Failed to embed company logo from ${logoPath}:`, logoErr.message);
        }
      }

      const headerTextX = logoRendered ? (margin + 135) : margin;
      const headerTextWidth = pageWidth - margin - headerTextX;

      doc.font(boldFont).fontSize(10.5).fillColor('#000000')
        .text('GAINTPRO SOFTWARE TECHNOLOGIES PRIVATE LIMITED', headerTextX, y + 2, {
          width: headerTextWidth,
          align: 'right',
        });

      doc.font(regularFont).fontSize(7.5).fillColor('#333333')
        .text(data.companyAddress, headerTextX, y + 18, {
          width: headerTextWidth,
          align: 'right',
        });

      doc.font(regularFont).fontSize(7.5).fillColor('#333333')
        .text('Email: contact@gaintpro.com  |  Tel: +91 9876543210  |  Web: https://www.gaintprosoftwaretechnologies.com/', headerTextX, y + 30, {
          width: headerTextWidth,
          align: 'right',
        });

      y += 54;

      // Divider line
      doc.moveTo(margin, y).lineTo(margin + contentWidth, y).lineWidth(0.75).strokeColor('#000000').stroke();
      y += 6;

      // Title Bar
      const titleBarHeight = 22;
      doc.rect(margin, y, contentWidth, titleBarHeight).fillAndStroke('#F1F5F9', '#000000').lineWidth(0.5);

      doc.font(boldFont).fontSize(10).fillColor('#000000')
        .text(`PAYSLIP FOR THE MONTH OF ${monthStr.toUpperCase()} ${pay.year}`, margin, y + 6, {
          width: contentWidth,
          align: 'center',
        });

      if (isPreview) {
        doc.font(boldFont).fontSize(7).fillColor('#D97706')
          .text('[ PREVIEW DRAFT ]', margin, y + 7, {
            width: contentWidth - 8,
            align: 'right',
          });
      }

      y += titleBarHeight + 8;

      // =======================================================================
      // 2. EMPLOYEE INFORMATION TABLE (Compact 4-column bordered grid)
      // =======================================================================
      const employeeName = ((emp.first_name || emp.last_name)
        ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
        : (emp.employee_name || emp.name || 'Employee'));
      const designation = emp.designation || 'Associate';
      const department = emp.department || 'General';
      const dateOfJoining = formatDate(emp.date_of_joining);
      const workLocation = emp.work_location || 'Not configured';

      const bankName = bank?.bank_name || 'Not configured';
      const bankAccountNo = bank?.account_number_last4 ? `XXXX-XXXX-${bank.account_number_last4}` : 'Not configured';
      const pan = emp.pan || emp.pan_number || 'Not configured';
      const uan = pf?.uan_number || 'Not configured';
      const pfNumber = pf?.pf_number || 'Not configured';

      const workingDays = pay.working_days !== null && pay.working_days !== undefined ? Number(pay.working_days) : 0;
      const payableDays = pay.payable_days !== null && pay.payable_days !== undefined ? Number(pay.payable_days) : 0;
      const paidDaysStr = payableDays.toFixed(2);
      const lopDaysStr = (pay.loss_of_pay_days !== undefined && pay.loss_of_pay_days !== null)
        ? Number(pay.loss_of_pay_days).toFixed(2)
        : Math.max(0, workingDays - payableDays).toFixed(2);

      const empTableY = y;
      const empRowHeight = 17.5;
      const labelColWidth = 95;
      const valColWidth = (contentWidth / 2) - labelColWidth; // 166.64

      const empGrid = [
        [
          { label: 'Employee ID', value: employeeId },
          { label: 'Employee Name', value: employeeName },
        ],
        [
          { label: 'Designation', value: designation },
          { label: 'Department', value: department },
        ],
        [
          { label: 'Date of Joining', value: dateOfJoining },
          { label: 'Work Location', value: workLocation },
        ],
        [
          { label: 'Bank Name', value: bankName },
          { label: 'Bank Account No.', value: bankAccountNo },
        ],
        [
          { label: 'PAN', value: pan },
          { label: 'UAN Number', value: uan },
        ],
        [
          { label: 'PF Number', value: pfNumber },
          { label: 'Payroll Month', value: periodStr },
        ],
        [
          { label: 'Paid Days', value: paidDaysStr },
          { label: 'Loss of Pay (LOP) Days', value: lopDaysStr },
        ],
      ];

      for (let r = 0; r < empGrid.length; r++) {
        const rowY = empTableY + r * empRowHeight;

        // Tint label columns with crisp light neutral
        doc.rect(margin, rowY, labelColWidth, empRowHeight).fill('#F8FAFC');
        doc.rect(margin + labelColWidth + valColWidth, rowY, labelColWidth, empRowHeight).fill('#F8FAFC');

        // Cell 1: Label
        doc.font(boldFont).fontSize(8).fillColor('#000000')
          .text(empGrid[r][0].label, margin + 5, rowY + 5, { width: labelColWidth - 10, lineBreak: false });
        // Cell 2: Value
        doc.font(regularFont).fontSize(8).fillColor('#000000')
          .text(empGrid[r][0].value, margin + labelColWidth + 5, rowY + 5, { width: valColWidth - 10, lineBreak: false, ellipsis: true });
        // Cell 3: Label
        doc.font(boldFont).fontSize(8).fillColor('#000000')
          .text(empGrid[r][1].label, margin + (contentWidth / 2) + 5, rowY + 5, { width: labelColWidth - 10, lineBreak: false });
        // Cell 4: Value
        doc.font(regularFont).fontSize(8).fillColor('#000000')
          .text(empGrid[r][1].value, margin + (contentWidth / 2) + labelColWidth + 5, rowY + 5, { width: valColWidth - 10, lineBreak: false, ellipsis: true });

        // Horizontal divider
        if (r > 0) {
          doc.moveTo(margin, rowY).lineTo(margin + contentWidth, rowY).lineWidth(0.5).strokeColor('#000000').stroke();
        }
      }

      const empTableHeight = empGrid.length * empRowHeight;

      // Vertical dividers
      doc.moveTo(margin + labelColWidth, empTableY).lineTo(margin + labelColWidth, empTableY + empTableHeight).lineWidth(0.5).strokeColor('#000000').stroke();
      doc.moveTo(margin + (contentWidth / 2), empTableY).lineTo(margin + (contentWidth / 2), empTableY + empTableHeight).lineWidth(0.5).strokeColor('#000000').stroke();
      doc.moveTo(margin + (contentWidth / 2) + labelColWidth, empTableY).lineTo(margin + (contentWidth / 2) + labelColWidth, empTableY + empTableHeight).lineWidth(0.5).strokeColor('#000000').stroke();

      // Outer table border
      doc.rect(margin, empTableY, contentWidth, empTableHeight).lineWidth(0.75).strokeColor('#000000').stroke();

      y = empTableY + empTableHeight + 10;

      // =======================================================================
      // 3. EARNINGS AND DEDUCTIONS (SIDE-BY-SIDE TABLES)
      // =======================================================================
      const basic = Number(pay.basic_salary) || 0;
      const hra = Number(pay.hra) || 0;
      const allowances = Number(pay.allowances) || 0;
      const bonus = Number(pay.bonus) || 0;
      const otherEarnings = Number(pay.other_earnings) || 0;
      const grossSalary = Number(pay.gross_salary) || (basic + hra + allowances + bonus + otherEarnings);

      const pfEmployee = Number(pay.pf_employee) || 0;
      const professionalTax = Number(pay.professional_tax) || 0;
      const tds = Number(pay.tds || pay.income_tax) || 0;
      const esi = Number(pay.esi) || 0;
      const otherDeductions = Number(pay.other_deductions) || 0;
      const totalDeductions = Number(pay.total_deductions) || (pfEmployee + professionalTax + tds + esi + otherDeductions);
      const netSalary = Number(pay.net_salary) || (grossSalary - totalDeductions);

      const earningsItems = [
        { label: 'Basic Salary', amount: basic },
        { label: 'House Rent Allowance (HRA)', amount: hra },
        { label: 'Special / Other Allowances', amount: allowances },
      ];
      if (bonus > 0) earningsItems.push({ label: 'Bonus / Incentive', amount: bonus });
      if (otherEarnings > 0) earningsItems.push({ label: 'Other Earnings', amount: otherEarnings });

      const deductionsItems = [
        { label: 'Provident Fund (Employee PF)', amount: pfEmployee },
        { label: 'Professional Tax', amount: professionalTax },
      ];
      if (tds > 0) deductionsItems.push({ label: 'Tax Deducted at Source (TDS)', amount: tds });
      if (esi > 0) deductionsItems.push({ label: 'Employee State Insurance (ESI)', amount: esi });
      if (otherDeductions > 0 || deductionsItems.length === 0) {
        deductionsItems.push({ label: 'Other Deductions', amount: otherDeductions });
      }

      const halfWidth = contentWidth / 2; // 261.64
      const descWidth = 165;
      const amtWidth = halfWidth - descWidth; // 96.64
      const thHeight = 20;
      const trHeight = 18;
      const rowsCount = Math.max(earningsItems.length, deductionsItems.length, 4);
      const bodyHeight = rowsCount * trHeight;
      const totalRowHeight = 20;
      const tableTotalHeight = thHeight + bodyHeight + totalRowHeight;

      // Table Header
      doc.rect(margin, y, contentWidth, thHeight).fillAndStroke('#F1F5F9', '#000000').lineWidth(0.5);

      // Left Header
      doc.font(boldFont).fontSize(8.5).fillColor('#000000')
        .text('EARNINGS', margin + 6, y + 5)
        .text('AMOUNT (₹)', margin + descWidth, y + 5, { width: amtWidth - 6, align: 'right' });

      // Right Header
      doc.font(boldFont).fontSize(8.5).fillColor('#000000')
        .text('DEDUCTIONS', margin + halfWidth + 6, y + 5)
        .text('AMOUNT (₹)', margin + halfWidth + descWidth, y + 5, { width: amtWidth - 6, align: 'right' });

      // Body Rows
      for (let i = 0; i < rowsCount; i++) {
        const trY = y + thHeight + i * trHeight;
        const rowBg = i % 2 === 0 ? '#FFFFFF' : '#FAFBFD';
        doc.rect(margin, trY, contentWidth, trHeight).fill(rowBg);

        // Earnings Cell
        if (earningsItems[i]) {
          doc.font(regularFont).fontSize(8).fillColor('#000000')
            .text(earningsItems[i].label, margin + 6, trY + 4, { width: descWidth - 10, lineBreak: false });
          doc.font(regularFont).fontSize(8).fillColor('#000000')
            .text(formatINR(earningsItems[i].amount), margin + descWidth, trY + 4, { width: amtWidth - 6, align: 'right' });
        }

        // Deductions Cell
        if (deductionsItems[i]) {
          doc.font(regularFont).fontSize(8).fillColor('#000000')
            .text(deductionsItems[i].label, margin + halfWidth + 6, trY + 4, { width: descWidth - 10, lineBreak: false });
          doc.font(regularFont).fontSize(8).fillColor('#000000')
            .text(formatINR(deductionsItems[i].amount), margin + halfWidth + descWidth, trY + 4, { width: amtWidth - 6, align: 'right' });
        }

        // Row Divider
        doc.moveTo(margin, trY + trHeight).lineTo(margin + contentWidth, trY + trHeight).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
      }

      // Totals Row
      const totY = y + thHeight + bodyHeight;
      doc.rect(margin, totY, contentWidth, totalRowHeight).fillAndStroke('#F1F5F9', '#000000').lineWidth(0.5);

      // Gross Salary Total
      doc.font(boldFont).fontSize(8.5).fillColor('#000000')
        .text('Total Earnings (Gross)', margin + 6, totY + 5)
        .text(formatINR(grossSalary), margin + descWidth, totY + 5, { width: amtWidth - 6, align: 'right' });

      // Total Deductions Total
      const formattedTotalDeductions = totalDeductions > 0
        ? `-₹${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : formatINR(totalDeductions);

      doc.font(boldFont).fontSize(8.5).fillColor('#000000')
        .text('Total Deductions', margin + halfWidth + 6, totY + 5)
        .text(formattedTotalDeductions, margin + halfWidth + descWidth, totY + 5, { width: amtWidth - 6, align: 'right' });

      // Grid Lines
      doc.rect(margin, y, contentWidth, tableTotalHeight).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.moveTo(margin + halfWidth, y).lineTo(margin + halfWidth, y + tableTotalHeight).lineWidth(0.75).strokeColor('#000000').stroke();
      doc.moveTo(margin + descWidth, y).lineTo(margin + descWidth, y + tableTotalHeight).lineWidth(0.5).strokeColor('#CBD5E1').stroke();
      doc.moveTo(margin + halfWidth + descWidth, y).lineTo(margin + halfWidth + descWidth, y + tableTotalHeight).lineWidth(0.5).strokeColor('#CBD5E1').stroke();

      y += tableTotalHeight + 10;

      // =======================================================================
      // 4. GROSS PAY AND NET PAY SUMMARY (Prominent Summary & Amount in Words)
      // =======================================================================
      const sumBoxHeight = 46;
      const sumColWidth = contentWidth / 3;

      doc.rect(margin, y, contentWidth, sumBoxHeight).fillAndStroke('#FFFFFF', '#000000').lineWidth(0.75);

      // Top row: 3 columns
      // Col 1: Gross Earnings
      doc.font(boldFont).fontSize(8.5).fillColor('#333333').text('Gross Earnings:', margin + 10, y + 6);
      doc.font(boldFont).fontSize(8.5).fillColor('#000000').text(formatINR(grossSalary), margin + 85, y + 6);

      // Col 2: Total Deductions
      doc.font(boldFont).fontSize(8.5).fillColor('#333333').text('Total Deductions:', margin + sumColWidth + 10, y + 6);
      doc.font(boldFont).fontSize(8.5).fillColor('#000000').text(formatINR(totalDeductions), margin + sumColWidth + 92, y + 6);

      // Col 3: Net Pay
      doc.rect(margin + sumColWidth * 2, y, sumColWidth, 23).fillAndStroke('#F1F5F9', '#000000').lineWidth(0.5);
      doc.font(boldFont).fontSize(9).fillColor('#000000').text('NET PAY:', margin + sumColWidth * 2 + 10, y + 6);
      doc.font(boldFont).fontSize(10).fillColor('#000000').text(formatINR(netSalary), margin + sumColWidth * 2 + 60, y + 5);

      // Divider inside summary box
      doc.moveTo(margin, y + 23).lineTo(margin + contentWidth, y + 23).lineWidth(0.5).strokeColor('#000000').stroke();

      // Bottom row: Amount in Words
      const netWords = numberToWordsINR(netSalary);
      doc.font(boldFont).fontSize(8).fillColor('#000000').text('Amount in Words:', margin + 10, y + 29);
      doc.font(regularFont).fontSize(8).fillColor('#000000').text(netWords, margin + 92, y + 29, {
        width: contentWidth - 100,
        lineBreak: false,
        ellipsis: true,
      });

      y += sumBoxHeight + 15;

      // =======================================================================
      // 5. OFFICIAL AUTHORIZATION AREA (Signature & Office Stamp)
      // =======================================================================
      const footerTopY = pageHeight - 55;
      const authHeight = 72;
      let authY = y + 10;
      if (authY + authHeight > footerTopY - 15) {
        authY = footerTopY - authHeight - 15;
      }

      const authBoxWidth = 200;

      // Left: Company Office Stamp
      const stampX = margin + 20;
      const stampY = authY;

      if (assetStatus.stampValid) {
        try {
          doc.image(assetStatus.stampPath, stampX + 45, stampY, {
            fit: [110, 48],
            align: 'center',
            valign: 'center',
          });
        } catch (imgErr) {
          if (shouldStrictlyRequireAssets) {
            throw new MissingPayslipAssetsError(
              `Company stamp image file at ${assetStatus.stampPath} is invalid or corrupted: ${imgErr.message}`,
              [{ type: 'stamp', label: 'Company Office Stamp', path: assetStatus.stampPath, reason: imgErr.message }]
            );
          }
        }
      } else if (isPreview) {
        doc.rect(stampX + 25, stampY + 4, authBoxWidth - 50, 44)
          .dash(3, { space: 3 })
          .lineWidth(0.8)
          .strokeColor('#94A3B8');
        doc.undash();

        doc.font(regularFont).fontSize(7.5).fillColor('#64748B')
          .text('[ OFFICIAL COMPANY STAMP ]', stampX, stampY + 16, { width: authBoxWidth, align: 'center' })
          .text('Genuine PNG Asset Location', stampX, stampY + 28, { width: authBoxWidth, align: 'center' });
      }

      doc.font(boldFont).fontSize(8).fillColor('#000000')
        .text('OFFICE STAMP', stampX, stampY + 52, { width: authBoxWidth, align: 'center' });
      doc.font(regularFont).fontSize(7).fillColor('#475569')
        .text('GaintPro Software Technologies Pvt. Ltd.', stampX, stampY + 62, { width: authBoxWidth, align: 'center' });

      // Right: Authorized Signatory
      const sigX = margin + contentWidth - authBoxWidth - 20;
      const sigY = authY;

      if (assetStatus.signatureValid) {
        try {
          doc.image(assetStatus.signaturePath, sigX + 35, sigY, {
            fit: [130, 44],
            align: 'center',
            valign: 'bottom',
          });
        } catch (imgErr) {
          if (shouldStrictlyRequireAssets) {
            throw new MissingPayslipAssetsError(
              `Authorized signature image file at ${assetStatus.signaturePath} is invalid or corrupted: ${imgErr.message}`,
              [{ type: 'signature', label: 'Authorized Signatory Signature', path: assetStatus.signaturePath, reason: imgErr.message }]
            );
          }
        }
      } else if (isPreview) {
        doc.rect(sigX + 25, sigY + 4, authBoxWidth - 50, 44)
          .dash(3, { space: 3 })
          .lineWidth(0.8)
          .strokeColor('#94A3B8');
        doc.undash();

        doc.font(regularFont).fontSize(7.5).fillColor('#64748B')
          .text('[ AUTHORIZED SIGNATORY ]', sigX, sigY + 16, { width: authBoxWidth, align: 'center' })
          .text('Genuine PNG Signature Location', sigX, sigY + 28, { width: authBoxWidth, align: 'center' });
      }

      doc.moveTo(sigX + 20, sigY + 50).lineTo(sigX + authBoxWidth - 20, sigY + 50).lineWidth(0.5).strokeColor('#000000').stroke();

      doc.font(boldFont).fontSize(8).fillColor('#000000')
        .text('AUTHORIZED SIGNATORY', sigX, sigY + 52, { width: authBoxWidth, align: 'center' });
      doc.font(regularFont).fontSize(7).fillColor('#475569')
        .text('GaintPro Software Technologies Pvt. Ltd.', sigX, sigY + 62, { width: authBoxWidth, align: 'center' });

      // =======================================================================
      // 6. FOOTER (Confidentiality & Computer-Generated Notice)
      // =======================================================================
      doc.moveTo(margin, footerTopY).lineTo(margin + contentWidth, footerTopY).lineWidth(0.5).strokeColor('#000000').stroke();

      doc.font(regularFont).fontSize(7.5).fillColor('#475569')
        .text('Note: This is a computer-generated payslip and does not require a physical signature unless stamped.', margin, footerTopY + 6, {
          width: contentWidth,
          align: 'center',
        });

      doc.font(regularFont).fontSize(7).fillColor('#64748B')
        .text('GaintPro Software Technologies Pvt. Ltd.  |  Confidential — For the employee\'s personal use only.  |  Page 1 of 1', margin, footerTopY + 18, {
          width: contentWidth,
          align: 'center',
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generatePayslipPdf,
  formatINR,
  getMonthName,
  formatDate,
  numberToWordsINR,
  getAuthorizationAssetPaths,
  checkAuthorizationAssets,
  getCompanyLogoPath,
  MissingPayslipAssetsError,
};
