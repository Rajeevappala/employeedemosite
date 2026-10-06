const PDFDocument = require('pdfkit');

/**
 * Service to generate official exit documents as PDF buffers using PDFKit.
 * Strictly separate from payslipPdfService.js to prevent regressions.
 */

function formatINR(val) {
  const num = typeof val === 'number' ? val : parseFloat(val) || 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateInput) {
  if (!dateInput) return 'N/A';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * 1. Generates Relieving Letter PDF buffer.
 */
function generateRelievingLetterPdf({ employee, exitRequest }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: false,
        info: {
          Title: `Relieving Letter - ${employee.employee_id}`,
          Author: 'GaintPro Software Technologies',
          Subject: 'Official Relieving Letter',
          Creator: 'GaintPro HR System',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 40;
      const contentWidth = doc.page.width - margin * 2;
      const darkColor = '#0F172A';
      const slateColor = '#1E293B';
      const mutedColor = '#64748B';

      let y = margin;

      // Header Banner
      doc.rect(margin, y, contentWidth, 70).fill(slateColor);

      doc.fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('GAINTPRO SOFTWARE TECHNOLOGIES', margin + 15, y + 16, { width: contentWidth - 30 });

      doc.fillColor('#94A3B8')
        .font('Helvetica')
        .fontSize(11)
        .text('OFFICIAL RELIEVING LETTER', margin + 15, y + 42, { width: contentWidth - 30 });

      y += 90;

      // Date & Reference
      const todayStr = formatDate(new Date());
      doc.fillColor(mutedColor).font('Helvetica').fontSize(10);
      doc.text(`Date: ${todayStr}`, margin, y);
      doc.text(`Ref: GP/HR/REL/${employee.employee_id}/${new Date().getFullYear()}`, margin, y + 15);

      y += 45;

      // Salutation & Addressee
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(11);
      doc.text(`To: ${employee.first_name || ''} ${employee.last_name || ''}`.trim(), margin, y);
      doc.font('Helvetica').fontSize(10).fillColor(mutedColor);
      doc.text(`Employee ID: ${employee.employee_id}`, margin, y + 16);
      doc.text(`Designation: ${employee.designation || 'Software Engineer'}`, margin, y + 30);
      doc.text(`Department: ${employee.department || 'Technology'}`, margin, y + 44);

      y += 75;

      // Subject
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(12);
      doc.text('SUBJECT: RELIEVING ORDER & ACCEPTANCE OF RESIGNATION', margin, y, { align: 'center', width: contentWidth });

      y += 30;

      // Body Paragraphs
      doc.font('Helvetica').fontSize(10.5).fillColor('#334155').lineGap(5);

      const empName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
      const resignationDate = formatDate(exitRequest.resignation_date);
      const relievingDate = formatDate(exitRequest.approved_relieving_date || exitRequest.requested_relieving_date);
      const joiningDate = formatDate(employee.date_of_joining);

      const p1 = `Dear ${empName},\n\nThis has reference to your formal resignation letter submitted on ${resignationDate}. We would like to inform you that your resignation has been accepted, and you are officially relieved from your duties and responsibilities as ${employee.designation || 'an Employee'} at GaintPro Software Technologies with effect from the close of business hours on ${relievingDate}.`;
      doc.text(p1, margin, y, { width: contentWidth, align: 'justify' });

      y += 85;

      const p2 = `During your tenure with our organization from ${joiningDate} to ${relievingDate}, your contributions, professionalism, and dedication towards company objectives were deeply appreciated.`;
      doc.text(p2, margin, y, { width: contentWidth, align: 'justify' });

      y += 45;

      const p3 = `We confirm that you have completed all mandatory clearance procedures across Information Technology, Finance, Human Resources, and Departmental handover. Your Full and Final (F&F) settlement has been processed accordingly.\n\nWe wish you all success and accomplishment in your future endeavors.`;
      doc.text(p3, margin, y, { width: contentWidth, align: 'justify' });

      y += 90;

      // Sign-off
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(10);
      doc.text('For GAINTPRO SOFTWARE TECHNOLOGIES', margin, y);

      y += 50;

      doc.strokeColor('#94A3B8').lineWidth(1).moveTo(margin, y).lineTo(margin + 180, y).stroke();
      doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
      doc.text('Authorized Signatory', margin, y + 5);
      doc.text('Human Resources Department', margin, y + 18);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 2. Generates Experience Certificate PDF buffer.
 */
function generateExperienceCertificatePdf({ employee, exitRequest }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: false,
        info: {
          Title: `Experience Certificate - ${employee.employee_id}`,
          Author: 'GaintPro Software Technologies',
          Subject: 'Service & Experience Certificate',
          Creator: 'GaintPro HR System',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 40;
      const contentWidth = doc.page.width - margin * 2;
      const darkColor = '#0F172A';
      const slateColor = '#1E293B';
      const mutedColor = '#64748B';

      let y = margin;

      // Header Banner
      doc.rect(margin, y, contentWidth, 70).fill(slateColor);

      doc.fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text('GAINTPRO SOFTWARE TECHNOLOGIES', margin + 15, y + 16, { width: contentWidth - 30 });

      doc.fillColor('#94A3B8')
        .font('Helvetica')
        .fontSize(11)
        .text('EXPERIENCE & SERVICE CERTIFICATE', margin + 15, y + 42, { width: contentWidth - 30 });

      y += 95;

      const todayStr = formatDate(new Date());
      doc.fillColor(mutedColor).font('Helvetica').fontSize(10);
      doc.text(`Date: ${todayStr}`, margin, y);
      doc.text(`Ref: GP/HR/EXP/${employee.employee_id}/${new Date().getFullYear()}`, margin, y + 15);

      y += 55;

      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(14);
      doc.text('TO WHOMSOEVER IT MAY CONCERN', margin, y, { align: 'center', width: contentWidth });

      y += 40;

      const empName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
      const joiningDate = formatDate(employee.date_of_joining);
      const relievingDate = formatDate(exitRequest.approved_relieving_date || exitRequest.requested_relieving_date);

      doc.font('Helvetica').fontSize(11).fillColor('#334155').lineGap(6);

      const text1 = `This is to certify that ${empName} (Employee ID: ${employee.employee_id}) was employed with GaintPro Software Technologies from ${joiningDate} to ${relievingDate}.`;
      doc.text(text1, margin, y, { width: contentWidth, align: 'justify' });

      y += 50;

      const text2 = `During the tenure of employment, ${empName} was designated as ${employee.designation || 'Software Engineer'} within the ${employee.department || 'Technology'} department. In this capacity, ${empName} demonstrated exceptional technical proficiency, sincerity, and commitment to organizational standards.`;
      doc.text(text2, margin, y, { width: contentWidth, align: 'justify' });

      y += 70;

      const text3 = `During the period of service, conduct and character were found to be good. This certificate is issued upon formal separation at the employee's own request.\n\nWe wish ${empName} all the best in future personal and professional endeavors.`;
      doc.text(text3, margin, y, { width: contentWidth, align: 'justify' });

      y += 100;

      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(10);
      doc.text('For GAINTPRO SOFTWARE TECHNOLOGIES', margin, y);

      y += 50;

      doc.strokeColor('#94A3B8').lineWidth(1).moveTo(margin, y).lineTo(margin + 180, y).stroke();
      doc.fillColor(mutedColor).font('Helvetica').fontSize(9);
      doc.text('Authorized Signatory', margin, y + 5);
      doc.text('Head of Human Resources', margin, y + 18);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 3. Generates Full & Final (F&F) Settlement Statement PDF buffer.
 */
function generateFnfSettlementPdf({ employee, exitRequest, settlement }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: false,
        info: {
          Title: `F&F Settlement - ${employee.employee_id}`,
          Author: 'GaintPro Software Technologies',
          Subject: 'Full and Final Settlement Statement',
          Creator: 'GaintPro HR & Payroll System',
        },
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 40;
      const contentWidth = doc.page.width - margin * 2;
      const slateColor = '#1E293B';
      const darkColor = '#0F172A';
      const mutedColor = '#64748B';
      const borderColor = '#CBD5E1';
      const lightBg = '#F8FAFC';

      let y = margin;

      // Header Banner
      doc.rect(margin, y, contentWidth, 65).fill(slateColor);

      doc.fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(17)
        .text('GAINTPRO SOFTWARE TECHNOLOGIES', margin + 15, y + 14, { width: contentWidth - 30 });

      doc.fillColor('#94A3B8')
        .font('Helvetica')
        .fontSize(10.5)
        .text('FULL & FINAL SETTLEMENT STATEMENT', margin + 15, y + 38, { width: contentWidth - 30 });

      y += 75;

      // Employee Info Grid
      doc.rect(margin, y, contentWidth, 70).fillAndStroke(lightBg, borderColor);
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(9.5);

      const col1 = margin + 12;
      const col2 = margin + 260;

      const empName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
      const joiningDate = formatDate(employee.date_of_joining);
      const relievingDate = formatDate(exitRequest.approved_relieving_date || exitRequest.requested_relieving_date);

      doc.text(`Employee Name: ${empName}`, col1, y + 10);
      doc.text(`Employee ID: ${employee.employee_id}`, col1, y + 26);
      doc.text(`Designation: ${employee.designation || 'N/A'}`, col1, y + 42);

      doc.text(`Department: ${employee.department || 'N/A'}`, col2, y + 10);
      doc.text(`Date of Joining: ${joiningDate}`, col2, y + 26);
      doc.text(`Relieving Date: ${relievingDate}`, col2, y + 42);

      y += 85;

      // Settlement Table Header
      doc.rect(margin, y, contentWidth, 22).fill(slateColor);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
      doc.text('EARNINGS / CREDITS', margin + 10, y + 6);
      doc.text('AMOUNT (INR)', margin + 170, y + 6);
      doc.text('DEDUCTIONS / DEBITS', margin + 270, y + 6);
      doc.text('AMOUNT (INR)', margin + 430, y + 6);

      y += 22;

      // Table Row Data
      const earnings = [
        { label: `Prorated Salary (${settlement.payable_days || 0} payable days)`, amount: settlement.prorated_salary || 0 },
        { label: `Leave Encashment (${settlement.encashed_leave_days || 0} PL days)`, amount: settlement.leave_encashment_amount || 0 },
        { label: 'Gratuity Payout', amount: settlement.gratuity_amount || 0 },
        { label: 'Bonus / Incentive', amount: settlement.bonus_or_incentive || 0 },
      ];

      const deductions = [
        { label: 'Notice Period Recovery', amount: settlement.notice_period_recovery || 0 },
        { label: 'Other Clearance Deductions', amount: settlement.other_deductions || 0 },
        { label: '-', amount: 0 },
        { label: '-', amount: 0 },
      ];

      doc.font('Helvetica').fontSize(9).fillColor('#334155');

      const maxRows = Math.max(earnings.length, deductions.length);
      const rowHeight = 22;

      for (let i = 0; i < maxRows; i++) {
        const bg = i % 2 === 0 ? '#FFFFFF' : lightBg;
        doc.rect(margin, y, contentWidth, rowHeight).fillAndStroke(bg, borderColor);

        const earn = earnings[i];
        if (earn && earn.label !== '-') {
          doc.fillColor('#1E293B').text(earn.label, margin + 10, y + 6, { width: 155 });
          doc.text(formatINR(earn.amount), margin + 170, y + 6);
        }

        const ded = deductions[i];
        if (ded && ded.label !== '-') {
          doc.fillColor('#1E293B').text(ded.label, margin + 270, y + 6, { width: 155 });
          doc.text(formatINR(ded.amount), margin + 430, y + 6);
        }

        y += rowHeight;
      }

      // Subtotals Row
      doc.rect(margin, y, contentWidth, 24).fillAndStroke('#F1F5F9', borderColor);
      doc.fillColor(darkColor).font('Helvetica-Bold').fontSize(9.5);
      doc.text('Total Earnings (A):', margin + 10, y + 7);
      doc.text(formatINR(settlement.total_earnings || 0), margin + 170, y + 7);

      doc.text('Total Deductions (B):', margin + 270, y + 7);
      doc.text(formatINR(settlement.total_deductions || 0), margin + 430, y + 7);

      y += 32;

      // Net Settlement Box
      doc.rect(margin, y, contentWidth, 36).fillAndStroke('#ECFDF5', '#6EE7B7');
      doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(12);
      doc.text('NET SETTLEMENT PAYABLE (A - B):', margin + 15, y + 12);
      doc.fontSize(13).text(formatINR(settlement.net_payable_amount || 0), margin + 350, y + 11, {
        align: 'right',
        width: contentWidth - 365,
      });

      y += 55;

      // Notes
      doc.fillColor(mutedColor).font('Helvetica').fontSize(8.5);
      doc.text('Notes:', margin, y);
      doc.text('1. All payments are subject to standard applicable tax deductions and regulatory compliance.', margin + 10, y + 12);
      doc.text('2. This settlement reflects complete fulfillment of mutual obligations between employer and employee.', margin + 10, y + 24);

      y += 55;

      // Signatures
      const sigY = y;
      doc.strokeColor('#CBD5E1').lineWidth(1);

      doc.moveTo(margin, sigY).lineTo(margin + 170, sigY).stroke();
      doc.fillColor(darkColor).font('Helvetica').fontSize(9);
      doc.text('Employee Signature', margin, sigY + 5);

      doc.moveTo(margin + contentWidth - 170, sigY).lineTo(margin + contentWidth, sigY).stroke();
      doc.text('Authorized Finance Signatory', margin + contentWidth - 170, sigY + 5);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateRelievingLetterPdf,
  generateExperienceCertificatePdf,
  generateFnfSettlementPdf,
  formatINR,
  formatDate,
};
