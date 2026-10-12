const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

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
 * Generates a clean, professional payslip PDF buffer.
 *
 * Features:
 * - Full Unicode font embedding (Noto Sans) for pristine ₹ (U+20B9) rendering.
 * - Consistent Indian currency formatting on all salary and deduction fields.
 * - Automated loading and aspect-ratio-preserved embedding of genuine company signature and office stamp.
 * - Safe validation preventing silent generation of signed payslips without genuine authorization assets.
 * - Test / Preview mode for layout verification before live payroll generation.
 *
 * @param {Object} params
 * @param {Object} params.employee Employee record from public.employees
 * @param {Object} params.payroll Finalized payroll record from public.payroll_records
 * @param {Object} [params.pfDetails] Optional PF details from public.pf_details
 * @param {boolean} [params.isPreview=false] When true, allows generating preview draft layout even if real assets are missing
 * @param {boolean} [params.requireAssets] Override whether genuine assets are strictly required (defaults to env PAYSLIP_REQUIRE_ASSETS === 'true')
 * @returns {Promise<Buffer>} Resolves to the generated PDF buffer
 */
function generatePayslipPdf({ employee, payroll, pfDetails, isPreview = false, requireAssets }) {
  return new Promise((resolve, reject) => {
    try {
      const assetStatus = checkAuthorizationAssets();
      const shouldStrictlyRequireAssets = typeof requireAssets === 'boolean'
        ? requireAssets
        : (!isPreview && process.env.PAYSLIP_REQUIRE_ASSETS === 'true');

      // Requirement 2.9: Safely reject if official signing requested but genuine assets are unavailable
      if (shouldStrictlyRequireAssets && !assetStatus.isComplete) {
        const missingLabels = assetStatus.missing.map(m => `${m.label} (${m.reason}: ${m.path})`).join('; ');
        throw new MissingPayslipAssetsError(
          `Official payslip cannot be generated: Required company authorization asset(s) are missing or unreadable. [${missingLabels}]. Please configure genuine PNG assets before issuing official signed payslips.`,
          assetStatus.missing
        );
      }

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: false,
        info: {
          Title: `Payslip - ${employee.employee_id} - ${getMonthName(payroll.month)} ${payroll.year}`,
          Author: 'GaintPro Software Technologies',
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

      const pageWidth = doc.page.width; // 595.28 for A4
      const margin = 40;
      const contentWidth = pageWidth - margin * 2; // 515.28

      // Curated corporate palette
      const darkColor = '#0F172A';
      const slateColor = '#1E293B';
      const mutedColor = '#64748B';
      const borderColor = '#CBD5E1';
      const lightBg = '#F8FAFC';
      const greenColor = '#15803D';

      let y = margin;

      // =======================================================================
      // 1. HEADER / ORGANIZATION TITLE & LOGO
      // =======================================================================
      const headerHeight = 75;
      doc.rect(margin, y, contentWidth, headerHeight).fill(slateColor);

      const logoPath = getCompanyLogoPath();
      let hasLogo = false;
      const logoBoxSize = 51;
      const logoBoxX = margin + 12;
      const logoBoxY = y + 12;

      if (logoPath) {
        try {
          // Draw clean rounded tile to frame the logo crisply against dark slate background
          doc.roundedRect(logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, 6).fill('#FFFFFF');
          // Embed genuine company logo with preserved aspect ratio
          doc.image(logoPath, logoBoxX + 2, logoBoxY + 2, {
            fit: [47, 47],
            align: 'center',
            valign: 'center',
          });
          hasLogo = true;
        } catch (logoErr) {
          console.error(`Failed to embed company logo from ${logoPath}:`, logoErr.message);
        }
      } else {
        console.warn('Company logo asset not found; rendering text-only header.');
      }

      const textX = hasLogo ? (logoBoxX + logoBoxSize + 14) : (margin + 15);
      const titleWidth = hasLogo
        ? (contentWidth - (textX - margin) - 120)
        : (contentWidth - 150);

      doc.fillColor('#FFFFFF')
        .font(boldFont)
        .fontSize(hasLogo ? 15 : 18)
        .text('GAINTPRO SOFTWARE TECHNOLOGIES', textX, y + 16, {
          width: titleWidth,
          align: 'left',
        });

      doc.fillColor('#94A3B8')
        .font(regularFont)
        .fontSize(hasLogo ? 10 : 11)
        .text('SALARY SLIP / PAYSLIP', textX, y + 42, {
          width: 250,
          align: 'left',
        });

      const periodStr = `${getMonthName(payroll.month)} ${payroll.year}`;
      doc.fillColor('#F8FAFC')
        .font(boldFont)
        .fontSize(10.5)
        .text(`Period: ${periodStr}`, margin + 15, y + 42, {
          width: contentWidth - 30,
          align: 'right',
        });

      // Subtle preview draft badge if in preview mode
      if (isPreview) {
        doc.fillColor('#FCD34D')
          .font(boldFont)
          .fontSize(8)
          .text('[ PREVIEW DRAFT - LAYOUT VERIFICATION ONLY ]', margin + 15, y + 57, {
            width: contentWidth - 30,
            align: 'right',
          });
      }

      y += 85;

      // =======================================================================
      // 2. EMPLOYEE DETAILS & ATTENDANCE BOX
      // =======================================================================
      const empBoxHeight = 85;
      doc.rect(margin, y, contentWidth, empBoxHeight)
        .lineWidth(1)
        .strokeColor(borderColor)
        .fillAndStroke(lightBg, borderColor);

      const col1X = margin + 15;
      const col2X = margin + 180;
      const col3X = margin + 350;

      const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.employee_name || 'Employee';
      const employeeId = employee.employee_id || payroll.employee_id;
      const designation = employee.designation || 'Staff';
      const department = employee.department || 'General';

      const workingDays = payroll.working_days !== null && payroll.working_days !== undefined
        ? Number(payroll.working_days)
        : '-';
      const payableDays = payroll.payable_days !== null && payroll.payable_days !== undefined
        ? Number(payroll.payable_days)
        : '-';

      // Row 1
      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('EMPLOYEE ID', col1X, y + 12);
      doc.font(boldFont).fontSize(10).fillColor(darkColor).text(employeeId, col1X, y + 24);

      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('EMPLOYEE NAME', col2X, y + 12);
      doc.font(boldFont).fontSize(10).fillColor(darkColor).text(employeeName, col2X, y + 24);

      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('TOTAL WORKING DAYS', col3X, y + 12);
      doc.font(boldFont).fontSize(10).fillColor(darkColor).text(String(workingDays), col3X, y + 24);

      // Row 2
      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('DESIGNATION', col1X, y + 48);
      doc.font(regularFont).fontSize(10).fillColor(darkColor).text(designation, col1X, y + 60);

      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('DEPARTMENT', col2X, y + 48);
      doc.font(regularFont).fontSize(10).fillColor(darkColor).text(department, col2X, y + 60);

      doc.font(boldFont).fontSize(9).fillColor(mutedColor).text('PAYABLE DAYS', col3X, y + 48);
      doc.font(boldFont).fontSize(10).fillColor(darkColor).text(String(payableDays), col3X, y + 60);

      y += empBoxHeight + 15;

      // =======================================================================
      // 3. EARNINGS & DEDUCTIONS TABLES (SIDE BY SIDE)
      // =======================================================================
      const tableWidth = (contentWidth - 15) / 2; // 250 each
      const tableHeaderHeight = 24;
      const rowHeight = 22;

      const earningsX = margin;
      const deductionsX = margin + tableWidth + 15;

      // Earnings Header
      doc.rect(earningsX, y, tableWidth, tableHeaderHeight).fill('#E2E8F0');
      doc.font(boldFont).fontSize(9).fillColor(slateColor)
        .text('EARNINGS', earningsX + 10, y + 7)
        .text('AMOUNT', earningsX + 10, y + 7, { width: tableWidth - 20, align: 'right' });

      // Deductions Header
      doc.rect(deductionsX, y, tableWidth, tableHeaderHeight).fill('#E2E8F0');
      doc.font(boldFont).fontSize(9).fillColor(slateColor)
        .text('DEDUCTIONS', deductionsX + 10, y + 7)
        .text('AMOUNT', deductionsX + 10, y + 7, { width: tableWidth - 20, align: 'right' });

      y += tableHeaderHeight;

      // Extract stored payroll components
      const basic = Number(payroll.basic_salary) || 0;
      const hra = Number(payroll.hra) || 0;
      const allowances = Number(payroll.allowances) || 0;
      const grossSalary = Number(payroll.gross_salary) || (basic + hra + allowances);

      const pf = Number(payroll.pf_employee) || 0;
      const pt = Number(payroll.professional_tax) || 0;
      const otherDeductions = Number(payroll.other_deductions) || 0;
      const totalDeductions = Number(payroll.total_deductions) || (pf + pt + otherDeductions);
      const netSalary = Number(payroll.net_salary) || (grossSalary - totalDeductions);

      const earningsItems = [
        { label: 'Basic Salary', amount: basic },
        { label: 'House Rent Allowance (HRA)', amount: hra },
        { label: 'Special / Other Allowances', amount: allowances },
      ];

      const deductionsItems = [
        { label: 'Provident Fund (Employee PF)', amount: pf },
        { label: 'Professional Tax', amount: pt },
        { label: 'Other Deductions', amount: otherDeductions },
      ];

      const rowsCount = Math.max(earningsItems.length, deductionsItems.length);

      for (let i = 0; i < rowsCount; i++) {
        const rowY = y + i * rowHeight;
        const rowBg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

        // Earnings row
        doc.rect(earningsX, rowY, tableWidth, rowHeight).fill(rowBg);
        if (earningsItems[i]) {
          doc.font(regularFont).fontSize(9).fillColor(darkColor)
            .text(earningsItems[i].label, earningsX + 10, rowY + 6);
          doc.font(regularFont).fontSize(9).fillColor(darkColor)
            .text(formatINR(earningsItems[i].amount), earningsX + 10, rowY + 6, {
              width: tableWidth - 20,
              align: 'right',
            });
        }

        // Deductions row
        doc.rect(deductionsX, rowY, tableWidth, rowHeight).fill(rowBg);
        if (deductionsItems[i]) {
          doc.font(regularFont).fontSize(9).fillColor(darkColor)
            .text(deductionsItems[i].label, deductionsX + 10, rowY + 6);
          doc.font(regularFont).fontSize(9).fillColor(darkColor)
            .text(formatINR(deductionsItems[i].amount), deductionsX + 10, rowY + 6, {
              width: tableWidth - 20,
              align: 'right',
            });
        }
      }

      y += rowsCount * rowHeight;

      // Totals Row
      const totalRowHeight = 26;
      // Gross Salary Total
      doc.rect(earningsX, y, tableWidth, totalRowHeight).fill('#F1F5F9');
      doc.font(boldFont).fontSize(10).fillColor(darkColor)
        .text('Gross Salary', earningsX + 10, y + 8)
        .text(formatINR(grossSalary), earningsX + 10, y + 8, {
          width: tableWidth - 20,
          align: 'right',
        });

      // Total Deductions Total (Consistently formatted with negative prefix)
      doc.rect(deductionsX, y, tableWidth, totalRowHeight).fill('#F1F5F9');
      const formattedTotalDeductions = totalDeductions > 0
        ? `-₹${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : formatINR(totalDeductions);

      doc.font(boldFont).fontSize(10).fillColor(darkColor)
        .text('Total Deductions', deductionsX + 10, y + 8)
        .text(formattedTotalDeductions, deductionsX + 10, y + 8, {
          width: tableWidth - 20,
          align: 'right',
        });

      y += totalRowHeight + 15;

      // =======================================================================
      // 4. NET SALARY CARD
      // =======================================================================
      const netCardHeight = 55;
      doc.rect(margin, y, contentWidth, netCardHeight)
        .lineWidth(1.5)
        .strokeColor(greenColor)
        .fillAndStroke('#F0FDF4', greenColor);

      doc.font(boldFont).fontSize(11).fillColor(slateColor)
        .text('NET SALARY PAYABLE', margin + 15, y + 14);

      const statusText = `Status: ${payroll.status || 'Processed'}`;
      doc.font(regularFont).fontSize(9).fillColor(mutedColor)
        .text(statusText, margin + 15, y + 32);

      doc.font(boldFont).fontSize(18).fillColor(greenColor)
        .text(formatINR(netSalary), margin + 15, y + 17, {
          width: contentWidth - 30,
          align: 'right',
        });

      y += netCardHeight + 20;

      // =======================================================================
      // 5. OPTIONAL PF / UAN INFORMATION (if available)
      // =======================================================================
      if (pfDetails && (pfDetails.uan_number || pfDetails.pf_number)) {
        doc.rect(margin, y, contentWidth, 34)
          .lineWidth(1)
          .strokeColor(borderColor)
          .fillAndStroke(lightBg, borderColor);

        let pfInfo = '';
        if (pfDetails.uan_number) pfInfo += `UAN: ${pfDetails.uan_number}   `;
        if (pfDetails.pf_number) pfInfo += `PF Number: ${pfDetails.pf_number}`;

        doc.font(boldFont).fontSize(9).fillColor(mutedColor)
          .text('PF DETAILS:', margin + 15, y + 11);
        doc.font(regularFont).fontSize(9).fillColor(darkColor)
          .text(pfInfo, margin + 90, y + 11);

        y += 44;
      }

      // =======================================================================
      // 6. OFFICIAL AUTHORIZATION AREA: SIGNATURE & COMPANY STAMP
      // =======================================================================
      const footerY = doc.page.height - 65;
      const authSectionHeight = 100;

      // Place authorization section neatly above footer with generous spacing
      let authY = Math.max(y + 15, footerY - authSectionHeight - 20);
      if (authY + authSectionHeight > footerY - 10) {
        authY = footerY - authSectionHeight - 10;
      }

      const authBoxWidth = 220;
      const authBoxHeight = 88;

      // --- Left Card: Official Company Office Stamp ---
      const stampBoxX = margin + 15;
      const stampBoxY = authY;

      if (assetStatus.stampValid) {
        // Embed genuine company stamp with aspect ratio preservation
        try {
          doc.image(assetStatus.stampPath, stampBoxX + (authBoxWidth - 110) / 2, stampBoxY + 4, {
            fit: [110, 52],
            align: 'center',
            valign: 'center',
          });
        } catch (imgErr) {
          console.error('Failed to embed company stamp image:', imgErr.message);
          if (shouldStrictlyRequireAssets) {
            throw new MissingPayslipAssetsError(
              `Company stamp image file at ${assetStatus.stampPath} is invalid or corrupted: ${imgErr.message}`,
              [{ type: 'stamp', label: 'Company Office Stamp', path: assetStatus.stampPath, reason: imgErr.message }]
            );
          }
        }
      } else if (isPreview) {
        // Preview layout guide for Company Stamp
        doc.rect(stampBoxX + 35, stampBoxY + 6, authBoxWidth - 70, 48)
          .dash(3, { space: 3 })
          .lineWidth(0.8)
          .strokeColor('#94A3B8');
        doc.undash();

        doc.font(regularFont).fontSize(7.5).fillColor(mutedColor)
          .text('[ OFFICIAL COMPANY STAMP ]', stampBoxX, stampBoxY + 18, {
            width: authBoxWidth,
            align: 'center',
          })
          .text('Genuine PNG Asset Location', stampBoxX, stampBoxY + 30, {
            width: authBoxWidth,
            align: 'center',
          });
      }

      // Stamp labels
      const stampLabelY = stampBoxY + 60;
      doc.font(boldFont).fontSize(8.5).fillColor(slateColor)
        .text('COMPANY STAMP', stampBoxX, stampLabelY, {
          width: authBoxWidth,
          align: 'center',
        });
      doc.font(regularFont).fontSize(7.5).fillColor(mutedColor)
        .text('GaintPro Software Technologies', stampBoxX, stampLabelY + 12, {
          width: authBoxWidth,
          align: 'center',
        });

      // --- Right Card: Authorized Signatory ---
      const sigBoxX = margin + contentWidth - authBoxWidth - 15;
      const sigBoxY = authY;

      if (assetStatus.signatureValid) {
        // Embed genuine authorized signature with aspect ratio preservation
        try {
          doc.image(assetStatus.signaturePath, sigBoxX + (authBoxWidth - 140) / 2, sigBoxY + 4, {
            fit: [140, 48],
            align: 'center',
            valign: 'bottom',
          });
        } catch (imgErr) {
          console.error('Failed to embed authorized signature image:', imgErr.message);
          if (shouldStrictlyRequireAssets) {
            throw new MissingPayslipAssetsError(
              `Authorized signature image file at ${assetStatus.signaturePath} is invalid or corrupted: ${imgErr.message}`,
              [{ type: 'signature', label: 'Authorized Signatory Signature', path: assetStatus.signaturePath, reason: imgErr.message }]
            );
          }
        }
      } else if (isPreview) {
        // Preview layout guide for Authorized Signatory
        doc.rect(sigBoxX + 25, sigBoxY + 6, authBoxWidth - 50, 48)
          .dash(3, { space: 3 })
          .lineWidth(0.8)
          .strokeColor('#94A3B8');
        doc.undash();

        doc.font(regularFont).fontSize(7.5).fillColor(mutedColor)
          .text('[ AUTHORIZED SIGNATORY ]', sigBoxX, sigBoxY + 18, {
            width: authBoxWidth,
            align: 'center',
          })
          .text('Genuine PNG Signature Location', sigBoxX, sigBoxY + 30, {
            width: authBoxWidth,
            align: 'center',
          });
      }

      // Signature divider line
      const sigLineY = sigBoxY + 58;
      doc.moveTo(sigBoxX + 20, sigLineY)
        .lineTo(sigBoxX + authBoxWidth - 20, sigLineY)
        .lineWidth(0.75)
        .strokeColor(borderColor)
        .stroke();

      // Signatory labels
      const sigLabelY = sigBoxY + 62;
      doc.font(boldFont).fontSize(8.5).fillColor(slateColor)
        .text('AUTHORIZED SIGNATORY', sigBoxX, sigLabelY, {
          width: authBoxWidth,
          align: 'center',
        });
      doc.font(regularFont).fontSize(7.5).fillColor(mutedColor)
        .text('GaintPro Software Technologies', sigBoxX, sigLabelY + 12, {
          width: authBoxWidth,
          align: 'center',
        });

      // =======================================================================
      // 7. FOOTER NOTICE
      // =======================================================================
      doc.moveTo(margin, footerY).lineTo(margin + contentWidth, footerY).lineWidth(0.75).strokeColor(borderColor).stroke();

      const footerNotice = assetStatus.isComplete
        ? 'This is an authorized payslip issued by GaintPro Software Technologies Pvt. Ltd. Confidential.'
        : (isPreview
            ? 'PREVIEW DRAFT — Generated for layout verification. Not an official financial document.'
            : 'This payslip is an official document generated by GaintPro Software Technologies Pvt. Ltd.');

      doc.font(regularFont).fontSize(8).fillColor(mutedColor).text(
        footerNotice,
        margin,
        footerY + 10,
        { width: contentWidth, align: 'center' }
      );

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
  getAuthorizationAssetPaths,
  checkAuthorizationAssets,
  getCompanyLogoPath,
  MissingPayslipAssetsError,
};
