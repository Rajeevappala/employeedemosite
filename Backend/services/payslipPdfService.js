const PDFDocument = require('pdfkit');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Formats a numeric currency value into INR format e.g. ₹25,000.00
 *
 * @param {number|string} val
 * @returns {string}
 */
function formatINR(val) {
  const num = typeof val === 'number' ? val : parseFloat(val) || 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
 * Generates a clean, professional payslip PDF buffer.
 *
 * @param {Object} params
 * @param {Object} params.employee Employee record from public.employees
 * @param {Object} params.payroll Finalized payroll record from public.payroll_records
 * @param {Object} [params.pfDetails] Optional PF details from public.pf_details
 * @returns {Promise<Buffer>} Resolves to the generated PDF buffer
 */
function generatePayslipPdf({ employee, payroll, pfDetails }) {
  return new Promise((resolve, reject) => {
    try {
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

      // Palette
      const darkColor = '#0F172A';
      const slateColor = '#1E293B';
      const mutedColor = '#64748B';
      const borderColor = '#CBD5E1';
      const lightBg = '#F8FAFC';
      const greenColor = '#15803D';

      let y = margin;

      // =======================================================================
      // 1. HEADER / ORGANIZATION TITLE
      // =======================================================================
      doc.rect(margin, y, contentWidth, 75).fill(slateColor);

      doc.fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('GAINTPRO SOFTWARE TECHNOLOGIES', margin + 15, y + 16, {
          width: contentWidth - 30,
          align: 'left',
        });

      doc.fillColor('#94A3B8')
        .font('Helvetica')
        .fontSize(11)
        .text('SALARY SLIP / PAYSLIP', margin + 15, y + 42, {
          width: contentWidth - 30,
          align: 'left',
        });

      const periodStr = `${getMonthName(payroll.month)} ${payroll.year}`;
      doc.fillColor('#F8FAFC')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`Period: ${periodStr}`, margin + 15, y + 42, {
          width: contentWidth - 30,
          align: 'right',
        });

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
      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('EMPLOYEE ID', col1X, y + 12);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor).text(employeeId, col1X, y + 24);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('EMPLOYEE NAME', col2X, y + 12);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor).text(employeeName, col2X, y + 24);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('TOTAL WORKING DAYS', col3X, y + 12);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor).text(String(workingDays), col3X, y + 24);

      // Row 2
      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('DESIGNATION', col1X, y + 48);
      doc.font('Helvetica').fontSize(10).fillColor(darkColor).text(designation, col1X, y + 60);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('DEPARTMENT', col2X, y + 48);
      doc.font('Helvetica').fontSize(10).fillColor(darkColor).text(department, col2X, y + 60);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor).text('PAYABLE DAYS', col3X, y + 48);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor).text(String(payableDays), col3X, y + 60);

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
      doc.font('Helvetica-Bold').fontSize(9).fillColor(slateColor)
        .text('EARNINGS', earningsX + 10, y + 7)
        .text('AMOUNT', earningsX + 10, y + 7, { width: tableWidth - 20, align: 'right' });

      // Deductions Header
      doc.rect(deductionsX, y, tableWidth, tableHeaderHeight).fill('#E2E8F0');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(slateColor)
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
          doc.font('Helvetica').fontSize(9).fillColor(darkColor)
            .text(earningsItems[i].label, earningsX + 10, rowY + 6);
          doc.font('Helvetica').fontSize(9).fillColor(darkColor)
            .text(formatINR(earningsItems[i].amount), earningsX + 10, rowY + 6, {
              width: tableWidth - 20,
              align: 'right',
            });
        }

        // Deductions row
        doc.rect(deductionsX, rowY, tableWidth, rowHeight).fill(rowBg);
        if (deductionsItems[i]) {
          doc.font('Helvetica').fontSize(9).fillColor(darkColor)
            .text(deductionsItems[i].label, deductionsX + 10, rowY + 6);
          doc.font('Helvetica').fontSize(9).fillColor(darkColor)
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
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor)
        .text('Gross Salary', earningsX + 10, y + 8)
        .text(formatINR(grossSalary), earningsX + 10, y + 8, {
          width: tableWidth - 20,
          align: 'right',
        });

      // Total Deductions Total
      doc.rect(deductionsX, y, tableWidth, totalRowHeight).fill('#F1F5F9');
      doc.font('Helvetica-Bold').fontSize(10).fillColor(darkColor)
        .text('Total Deductions', deductionsX + 10, y + 8)
        .text(`-${formatINR(totalDeductions)}`, deductionsX + 10, y + 8, {
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

      doc.font('Helvetica-Bold').fontSize(11).fillColor(slateColor)
        .text('NET SALARY PAYABLE', margin + 15, y + 14);

      const statusText = `Status: ${payroll.status || 'Processed'}`;
      doc.font('Helvetica').fontSize(9).fillColor(mutedColor)
        .text(statusText, margin + 15, y + 32);

      doc.font('Helvetica-Bold').fontSize(18).fillColor(greenColor)
        .text(formatINR(netSalary), margin + 15, y + 17, {
          width: contentWidth - 30,
          align: 'right',
        });

      y += netCardHeight + 20;

      // =======================================================================
      // 5. OPTIONAL PF / UAN INFORMATION (if available)
      // =======================================================================
      if (pfDetails && (pfDetails.uan_number || pfDetails.pf_number)) {
        doc.rect(margin, y, contentWidth, 36)
          .lineWidth(1)
          .strokeColor(borderColor)
          .fillAndStroke(lightBg, borderColor);

        let pfInfo = '';
        if (pfDetails.uan_number) pfInfo += `UAN: ${pfDetails.uan_number}   `;
        if (pfDetails.pf_number) pfInfo += `PF Number: ${pfDetails.pf_number}`;

        doc.font('Helvetica-Bold').fontSize(9).fillColor(mutedColor)
          .text('PF DETAILS:', margin + 15, y + 12);
        doc.font('Helvetica').fontSize(9).fillColor(darkColor)
          .text(pfInfo, margin + 90, y + 12);

        y += 48;
      }

      // =======================================================================
      // 6. FOOTER NOTICE
      // =======================================================================
      const footerY = doc.page.height - 65;
      doc.moveTo(margin, footerY).lineTo(margin + contentWidth, footerY).strokeColor(borderColor).stroke();

      doc.font('Helvetica').fontSize(8).fillColor(mutedColor).text(
        'This is a computer-generated payslip issued by GaintPro Software Technologies and does not require a physical signature.',
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
};
