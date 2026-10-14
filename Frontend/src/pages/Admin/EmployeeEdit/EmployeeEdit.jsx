import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import './EmployeeEdit.css';

const STEPS = [
  { number: 1, label: 'Basic' },
  { number: 2, label: 'Personal' },
  { number: 3, label: 'Employment' },
  { number: 4, label: 'PF Details' },
  { number: 5, label: 'Bank Details' },
  { number: 6, label: 'Salary' },
  { number: 7, label: 'Leaves' },
  { number: 8, label: 'Documents' },
  { number: 9, label: 'Review' },
];

const APPROVED_BANKS = [
  'IDFC Bank',
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Canara Bank',
  'Union Bank of India',
  'IndusInd Bank',
  'Federal Bank',
  'Yes Bank',
  'Other',
];

const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary'];

const INITIAL_EDIT_DATA = {
  // Step 1: Basic Information
  employeeId: '',
  firstName: '',
  lastName: '',
  email: '',
  personalEmail: '',
  phone: '',
  profilePhoto: null,

  // Step 2: Personal & Contact Details
  dateOfBirth: '',
  gender: 'Male',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',

  // Step 3: Employment Details
  designation: '',
  department: 'IT',
  dateOfJoining: '',
  employmentType: 'Full Time',
  reportingManager: '',
  workLocation: 'Hyderabad',
  status: 'ACTIVE',
  workingDaysPerWeek: '5',

  // Step 4: PF Details
  pfNotAvailable: false,
  uanNumber: '',
  pfNumber: '',
  pensionNumber: '',
  employeeContribution: '',
  employerContribution: '',

  // Step 5: Bank Details
  bankNotAvailable: false,
  bankAccountHolderName: '',
  bankName: 'IDFC Bank',
  bankAccountNumber: '',
  bankConfirmAccountNumber: '',
  bankIfscCode: '',
  bankBranchName: '',
  bankBranchCity: '',
  bankBranchState: '',
  bankAccountType: 'Savings',
  bankVerificationStatus: 'Pending',

  // Step 6: Salary & Payroll
  basicSalary: '40000',
  hra: '16000',
  allowances: '8000',
  pfEmployee: '1800',
  professionalTax: '200',
  otherDeductions: '0',

  // Step 7: Leave Setup
  paidLeave: '12',
  sickLeave: '10',
  unpaidLeave: '0',

  // Step 8: Documents (new file uploads)
  offerLetter: null,
  appointmentLetter: null,
  aadhaarCard: null,
  panCard: null,
  educationalCertificate: null,
  pfDocument: null,
  otherDocument: null,
};

const ALLOWED_DESIGNATIONS = ['Associate Software Engineer', 'Associate'];

export default function EmployeeEdit() {
  const { employeeId } = useParams();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(INITIAL_EDIT_DATA);
  const [initialData, setInitialData] = useState(null);
  const [existingDocuments, setExistingDocuments] = useState([]);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');


  const [masterOptions, setMasterOptions] = useState({
    departments: ['IT', 'Non-IT'],
    designations: ALLOWED_DESIGNATIONS,
    employmentTypes: ['Full Time', 'Part Time', 'Contract', 'Intern', 'Probationary'],
    locations: ['Hyderabad', 'Hyderabad HQ', 'Bangalore', 'Mumbai', 'Pune', 'Remote'],
  });

  useEffect(() => {
    let isMounted = true;
    api.admin.settings.employees.get()
      .then((res) => {
        if (isMounted && res?.success && res.data) {
          const depts = (res.data.departments || []).filter((d) => d.is_active).map((d) => d.name);
          const desigs = (res.data.designations || [])
            .filter((d) => d.is_active && ALLOWED_DESIGNATIONS.includes(d.name))
            .map((d) => d.name);
          const empTypes = (res.data.employmentTypes || []).filter((e) => e.is_active).map((e) => e.name);
          const locs = (res.data.locations || []).filter((l) => l.is_active).map((l) => l.name);

          setMasterOptions((prev) => ({
            departments: depts.length > 0 ? depts : prev.departments,
            designations: desigs.length > 0 ? desigs : ALLOWED_DESIGNATIONS,
            employmentTypes: empTypes.length > 0 ? empTypes : prev.employmentTypes,
            locations: locs.length > 0 ? locs : prev.locations,
          }));
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Unsaved changes confirmation modal
  const [showExitModal, setShowExitModal] = useState(false);

  // Document preview modal
  const [previewDocModal, setPreviewDocModal] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Check if form has unsaved modifications
  const isDirty = useMemo(() => {
    if (!initialData) return false;
    for (const key of Object.keys(initialData)) {
      if (['profilePhoto', 'offerLetter', 'appointmentLetter', 'aadhaarCard', 'panCard', 'educationalCertificate', 'pfDocument', 'otherDocument'].includes(key)) {
        if (formData[key] !== null) return true;
      } else {
        if (String(formData[key] || '') !== String(initialData[key] || '')) {
          return true;
        }
      }
    }
    return false;
  }, [formData, initialData]);

  // Window beforeunload warning when dirty
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Clean up document preview Blob URL
  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  // Load complete employee data
  const loadEmployeeRecord = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.admin.getEmployee(employeeId);
      if (res && res.success && res.data) {
        const emp = res.data;
        const payroll = emp.payroll_profile || emp.payroll_profiles || {};
        const leaves = emp.leave_balances || emp.leave_summary || {};
        const pf = emp.pf_details || {};
        const bank = emp.bank_details || emp.bank || {};
        const hasBankRecord = Boolean(bank && (bank.account_number_last4 || bank.account_number || bank.account_number_masked || bank.account_holder_name || bank.bank_name));

        const mapped = {
          // Step 1: Basic
          employeeId: emp.employee_id || '',
          firstName: emp.first_name || '',
          lastName: emp.last_name || '',
          email: emp.email || '',
          personalEmail: emp.personal_email || '',
          phone: emp.phone || '',
          profilePhoto: null,

          // Step 2: Personal
          dateOfBirth: emp.date_of_birth ? emp.date_of_birth.split('T')[0] : '',
          gender: emp.gender || 'Male',
          address: emp.address || '',
          city: emp.city || '',
          state: emp.state || '',
          postalCode: emp.postal_code || emp.pincode || '',
          emergencyContactName: emp.emergency_contact_name || '',
          emergencyContactPhone: emp.emergency_contact_phone || '',
          emergencyContactRelationship: emp.emergency_contact_relationship || '',

          // Step 3: Employment
          designation: emp.designation || '',
          department: emp.department || 'Technology',
          dateOfJoining: emp.date_of_joining ? emp.date_of_joining.split('T')[0] : '',
          employmentType: emp.employment_type || 'Full Time',
          reportingManager: emp.reporting_manager || '',
          workLocation: emp.work_location || 'Hyderabad',
          status: emp.status || 'ACTIVE',
          workingDaysPerWeek: String(emp.working_days_per_week || 5),

          // Step 4: PF
          pfNotAvailable: pf.pf_status === 'NOT_APPLICABLE' || (!pf.uan_number && !pf.pf_number),
          uanNumber: pf.uan_number || '',
          pfNumber: pf.pf_number || '',
          pensionNumber: pf.pension_number || '',
          employeeContribution: pf.employee_contribution !== null && pf.employee_contribution !== undefined ? String(pf.employee_contribution) : '',
          employerContribution: pf.employer_contribution !== null && pf.employer_contribution !== undefined ? String(pf.employer_contribution) : '',

          // Step 5: Bank Details
          bankNotAvailable: !hasBankRecord,
          bankAccountHolderName: bank.account_holder_name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
          bankName: bank.bank_name || 'IDFC Bank',
          bankAccountNumber: bank.account_number || bank.account_number_masked || (bank.account_number_last4 ? `••••••••${bank.account_number_last4}` : ''),
          bankConfirmAccountNumber: bank.account_number || bank.account_number_masked || (bank.account_number_last4 ? `••••••••${bank.account_number_last4}` : ''),
          bankIfscCode: bank.ifsc_code || '',
          bankBranchName: bank.branch_name || '',
          bankBranchCity: bank.branch_city || '',
          bankBranchState: bank.branch_state || '',
          bankAccountType: bank.account_type || 'Savings',
          bankVerificationStatus: bank.verification_status || 'Pending',

          // Step 6: Salary
          basicSalary: String(payroll.basic_salary ?? '40000'),
          hra: String(payroll.hra ?? '16000'),
          allowances: String(payroll.allowances ?? '8000'),
          pfEmployee: String(payroll.pf_employee ?? '1800'),
          professionalTax: String(payroll.professional_tax ?? '200'),
          otherDeductions: String(payroll.other_deductions ?? '0'),

          // Step 7: Leaves
          paidLeave: String(leaves.paid_leave_balance ?? leaves.pl?.remaining ?? leaves.pl?.total ?? '12'),
          sickLeave: String(leaves.sick_leave_balance ?? leaves.sick?.remaining ?? leaves.sick?.total ?? '10'),
          unpaidLeave: String(leaves.unpaid_leave_balance ?? leaves.upl?.used ?? '0'),

          // Step 8: Documents (new files initially null)
          offerLetter: null,
          appointmentLetter: null,
          aadhaarCard: null,
          panCard: null,
          educationalCertificate: null,
          pfDocument: null,
          otherDocument: null,
        };

        setFormData(mapped);
        setInitialData({ ...mapped });
        setExistingDocuments(Array.isArray(emp.documents) ? emp.documents : []);

        // Load profile photo blob URL if available
        if (emp.has_profile_photo) {
          try {
            const photoBlob = await api.admin.getEmployeePhotoBlob(emp.employee_id);
            if (photoBlob && photoBlob.size > 0) {
              setExistingPhotoUrl(URL.createObjectURL(photoBlob));
            }
          } catch {
            setExistingPhotoUrl(null);
          }
        }
      } else {
        setError('Unable to load employee details.');
      }
    } catch (err) {
      setError(err.message || 'Unable to load employee details.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadEmployeeRecord();
  }, [loadEmployeeRecord]);

  // Salary calculations
  const salaryCalculations = useMemo(() => {
    const basic = Math.max(0, parseFloat(formData.basicSalary) || 0);
    const hra = Math.max(0, parseFloat(formData.hra) || 0);
    const allowances = Math.max(0, parseFloat(formData.allowances) || 0);
    const pf = Math.max(0, parseFloat(formData.pfEmployee) || 0);
    const pt = Math.max(0, parseFloat(formData.professionalTax) || 0);
    const other = Math.max(0, parseFloat(formData.otherDeductions) || 0);

    const gross = basic + hra + allowances;
    const deductions = pf + pt + other;
    const net = gross - deductions;

    return { gross, deductions, net };
  }, [formData.basicSalary, formData.hra, formData.allowances, formData.pfEmployee, formData.professionalTax, formData.otherDeductions]);

  const editBankAccTrimmed = (formData.bankAccountNumber || '').trim();
  const editBankConfirmTrimmed = (formData.bankConfirmAccountNumber || '').trim();
  const isEditingNewAcc = !editBankAccTrimmed.includes('•');
  const isEditBankMismatch = !formData.bankNotAvailable &&
    isEditingNewAcc &&
    Boolean(editBankConfirmTrimmed) &&
    editBankAccTrimmed !== editBankConfirmTrimmed;

  // Form input changes
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setStepError('');
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFileChange = (e, fieldName) => {
    const file = e.target.files && e.target.files[0];
    setStepError('');
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setStepError(`File '${file.name}' exceeds the maximum allowed size of 10 MB.`);
        return;
      }
      setFormData((prev) => ({
        ...prev,
        [fieldName]: file,
      }));
    }
  };

  const handleRemoveFile = (fieldName) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: null,
    }));
  };

  // Validation rules (matches employee creation wizard)
  const validateStep = (stepNumber) => {
    setStepError('');

    if (stepNumber === 1) {
      if (!formData.firstName.trim()) {
        setStepError('First name is required.');
        return false;
      }
      if (!formData.lastName.trim()) {
        setStepError('Last name is required.');
        return false;
      }
      if (!formData.email.trim()) {
        setStepError('Official email is required.');
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
        setStepError('Invalid official email format.');
        return false;
      }
      if (formData.personalEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.personalEmail.trim())) {
        setStepError('Invalid personal email format.');
        return false;
      }
      if (!formData.phone.trim()) {
        setStepError('Phone number is required.');
        return false;
      }
      const digitsOnly = formData.phone.replace(/\D/g, '');
      if (digitsOnly.length !== 10) {
        setStepError('Phone number must be exactly 10 digits.');
        return false;
      }
      return true;
    }

    if (stepNumber === 2) {
      if (!formData.dateOfBirth) {
        setStepError('Date of birth is required.');
        return false;
      }
      if (!formData.gender) {
        setStepError('Gender is required.');
        return false;
      }
      if (!formData.address.trim()) {
        setStepError('Residential address is required.');
        return false;
      }
      if (!formData.city.trim()) {
        setStepError('City is required.');
        return false;
      }
      if (!formData.state.trim()) {
        setStepError('State is required.');
        return false;
      }
      if (!formData.postalCode.trim()) {
        setStepError('Postal code is required.');
        return false;
      }
      if (!formData.emergencyContactName.trim()) {
        setStepError('Emergency contact name is required.');
        return false;
      }
      if (!formData.emergencyContactPhone.trim()) {
        setStepError('Emergency contact phone number is required.');
        return false;
      }
      const emDigits = formData.emergencyContactPhone.replace(/\D/g, '');
      if (emDigits.length < 10) {
        setStepError('Emergency contact number must be at least 10 digits.');
        return false;
      }
      if (!formData.emergencyContactRelationship.trim()) {
        setStepError('Emergency contact relationship is required.');
        return false;
      }
      return true;
    }

    if (stepNumber === 3) {
      if (!formData.designation.trim()) {
        setStepError('Designation is required.');
        return false;
      }
      if (!ALLOWED_DESIGNATIONS.includes(formData.designation.trim())) {
        setStepError('Please select a valid designation (Associate Software Engineer or Associate).');
        return false;
      }
      if (!formData.department) {
        setStepError('Department is required.');
        return false;
      }
      if (!formData.dateOfJoining) {
        setStepError('Date of joining is required.');
        return false;
      }
      if (!formData.employmentType) {
        setStepError('Employment type is required.');
        return false;
      }
      if (!formData.workLocation.trim()) {
        setStepError('Work location is required.');
        return false;
      }
      if (!formData.status) {
        setStepError('Employee status is required.');
        return false;
      }
      if (!formData.workingDaysPerWeek || !['5', '6', 5, 6].includes(formData.workingDaysPerWeek)) {
        setStepError('Working days per week is required (select 5 or 6).');
        return false;
      }
      return true;
    }

    if (stepNumber === 4) {
      if (!formData.pfNotAvailable) {
        if (formData.uanNumber.trim()) {
          const uan = formData.uanNumber.trim();
          if (!/^\d{12}$/.test(uan)) {
            setStepError('UAN number must be exactly 12 numeric digits.');
            return false;
          }
        }
        if (formData.employeeContribution && formData.employeeContribution.trim()) {
          const val = parseFloat(formData.employeeContribution.trim());
          if (isNaN(val) || val < 0) {
            setStepError('Employee contribution must be a valid non-negative amount.');
            return false;
          }
        }
        if (formData.employerContribution && formData.employerContribution.trim()) {
          const val = parseFloat(formData.employerContribution.trim());
          if (isNaN(val) || val < 0) {
            setStepError('Employer contribution must be a valid non-negative amount.');
            return false;
          }
        }
      }
      return true;
    }

    if (stepNumber === 5) {
      if (!formData.bankNotAvailable) {
        if (!formData.bankAccountHolderName.trim()) {
          setStepError('Account holder name is required.');
          return false;
        }
        if (!formData.bankName.trim()) {
          setStepError('Bank name is required.');
          return false;
        }
        if (!formData.bankAccountNumber.trim()) {
          setStepError('Account number is required.');
          return false;
        }
        const accNum = formData.bankAccountNumber.trim();
        if (!accNum.includes('•')) {
          if (!/^\d{9,18}$/.test(accNum)) {
            setStepError('Account number must contain between 9 and 18 numeric digits.');
            return false;
          }
          if (!formData.bankConfirmAccountNumber.trim()) {
            setStepError('Please confirm the account number.');
            return false;
          }
          if (accNum !== formData.bankConfirmAccountNumber.trim()) {
            setStepError('Account numbers do not match. Please verify and re-enter.');
            return false;
          }
        }
        if (!formData.bankIfscCode.trim()) {
          setStepError('IFSC code is required.');
          return false;
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.bankIfscCode.trim().toUpperCase())) {
          setStepError('Invalid IFSC code format (e.g., IDFB0001001).');
          return false;
        }
        if (!ACCOUNT_TYPES.includes(formData.bankAccountType)) {
          setStepError('Account type must be Savings, Current, or Salary.');
          return false;
        }
      }
      return true;
    }

    if (stepNumber === 6) {
      const basic = parseFloat(formData.basicSalary);
      const hra = parseFloat(formData.hra);
      const allowances = parseFloat(formData.allowances);
      const pf = parseFloat(formData.pfEmployee);
      const pt = parseFloat(formData.professionalTax);
      const other = parseFloat(formData.otherDeductions);

      if (isNaN(basic) || basic < 0) {
        setStepError('Basic salary must be a non-negative number.');
        return false;
      }
      if (isNaN(hra) || hra < 0) {
        setStepError('HRA must be a non-negative number.');
        return false;
      }
      if (isNaN(allowances) || allowances < 0) {
        setStepError('Allowances must be a non-negative number.');
        return false;
      }
      if (isNaN(pf) || pf < 0) {
        setStepError('Employee PF deduction must be a non-negative number.');
        return false;
      }
      if (isNaN(pt) || pt < 0) {
        setStepError('Professional tax must be a non-negative number.');
        return false;
      }
      if (isNaN(other) || other < 0) {
        setStepError('Other deductions must be a non-negative number.');
        return false;
      }
      return true;
    }

    if (stepNumber === 7) {
      const pl = parseFloat(formData.paidLeave);
      const sl = parseFloat(formData.sickLeave);
      const upl = parseFloat(formData.unpaidLeave);

      if (isNaN(pl) || pl < 0) {
        setStepError('Paid leave balance must be a non-negative number.');
        return false;
      }
      if (isNaN(sl) || sl < 0) {
        setStepError('Sick leave balance must be a non-negative number.');
        return false;
      }
      if (isNaN(upl) || upl < 0) {
        setStepError('Unpaid leave balance must be a non-negative number.');
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep === 4 && !formData.bankAccountHolderName) {
        const autoHolder = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();
        if (autoHolder) {
          setFormData((prev) => ({
            ...prev,
            bankAccountHolderName: autoHolder,
          }));
        }
      }
      setCurrentStep((prev) => Math.min(prev + 1, 9));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setStepError('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJumpToStep = (targetStep) => {
    // If jumping forward, validate intermediate steps
    if (targetStep > currentStep) {
      for (let s = currentStep; s < targetStep; s++) {
        if (!validateStep(s)) {
          setCurrentStep(s);
          return;
        }
      }
    }
    setStepError('');
    setCurrentStep(targetStep);
  };

  // Exit with confirmation if dirty
  const handleAttemptExit = () => {
    if (isDirty) {
      setShowExitModal(true);
    } else {
      navigate(`/admin/employees/${employeeId}`);
    }
  };

  const handleConfirmDiscard = () => {
    setShowExitModal(false);
    navigate(`/admin/employees/${employeeId}`);
  };

  // Document preview handler
  const handlePreviewDoc = async (doc) => {
    try {
      setPreviewDocModal(doc);
      setPreviewLoading(true);
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl(null);
      }
      const blob = await api.admin.viewDocument(doc.id);
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
    } catch (err) {
      alert(err.message || 'Failed to preview document.');
      setPreviewDocModal(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadDoc = async (doc) => {
    try {
      const blob = await api.admin.downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || `${doc.document_type}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Failed to download document.');
    }
  };

  // Field change diffing for Step 8 (Review Changes)
  const modifiedFields = useMemo(() => {
    if (!initialData) return [];
    const diffs = [];

    const fieldLabels = {
      firstName: 'First Name',
      lastName: 'Last Name',
      personalEmail: 'Personal Email',
      phone: 'Phone',
      dateOfBirth: 'Date of Birth',
      gender: 'Gender',
      address: 'Address',
      city: 'City',
      state: 'State',
      postalCode: 'Postal Code',
      emergencyContactName: 'Emergency Contact Name',
      emergencyContactPhone: 'Emergency Contact Phone',
      emergencyContactRelationship: 'Emergency Contact Relationship',
      designation: 'Designation',
      department: 'Department',
      dateOfJoining: 'Date of Joining',
      employmentType: 'Employment Type',
      reportingManager: 'Reporting Manager',
      workLocation: 'Work Location',
      status: 'Status',
      workingDaysPerWeek: 'Working Days / Week',
      pfNotAvailable: 'PF Status',
      uanNumber: 'UAN Number',
      pfNumber: 'PF Number',
      pensionNumber: 'Pension Number',
      employeeContribution: 'PF Employee Contribution (₹)',
      employerContribution: 'PF Employer Contribution (₹)',
      bankNotAvailable: 'Bank Status',
      bankAccountHolderName: 'Account Holder Name',
      bankName: 'Bank Name',
      bankAccountNumber: 'Account Number',
      bankIfscCode: 'IFSC Code',
      bankBranchName: 'Branch Name',
      bankBranchCity: 'Branch City',
      bankBranchState: 'Branch State',
      bankAccountType: 'Account Type',
      bankVerificationStatus: 'Bank Verification Status',
      basicSalary: 'Basic Salary (₹)',
      hra: 'HRA (₹)',
      allowances: 'Allowances (₹)',
      pfEmployee: 'Employee PF (₹)',
      professionalTax: 'Professional Tax (₹)',
      otherDeductions: 'Other Deductions (₹)',
      paidLeave: 'Paid Leave Balance',
      sickLeave: 'Sick Leave Balance',
      unpaidLeave: 'Unpaid Leave Balance',
    };

    for (const [key, label] of Object.entries(fieldLabels)) {
      const oldVal = String(initialData[key] || '');
      const newVal = String(formData[key] || '');
      if (oldVal !== newVal) {
        diffs.push({
          key,
          label,
          oldValue: oldVal || '—',
          newValue: newVal || '—',
        });
      }
    }

    // Check newly staged files
    const fileKeys = [
      { key: 'profilePhoto', label: 'New Profile Photo' },
      { key: 'offerLetter', label: 'New Offer Letter' },
      { key: 'appointmentLetter', label: 'New Appointment Letter' },
      { key: 'aadhaarCard', label: 'New Aadhaar Card' },
      { key: 'panCard', label: 'New PAN Card' },
      { key: 'educationalCertificate', label: 'New Educational Certificate' },
      { key: 'pfDocument', label: 'New PF Document' },
      { key: 'otherDocument', label: 'New Document' },
    ];

    for (const f of fileKeys) {
      if (formData[f.key]) {
        diffs.push({
          key: f.key,
          label: f.label,
          oldValue: 'Existing / None',
          newValue: formData[f.key].name,
        });
      }
    }

    return diffs;
  }, [formData, initialData]);

  // Submit complete update
  const handleSave = async () => {
    if (isEditBankMismatch) {
      setStepError('Account numbers do not match.');
      setCurrentStep(5);
      return;
    }

    // Validate all steps 1 through 7
    for (let s = 1; s <= 7; s++) {
      if (!validateStep(s)) {
        setCurrentStep(s);
        return;
      }
    }

    setSubmitting(true);
    setStepError('');

    try {
      const payload = new FormData();

      // Step 1: Basic
      payload.append('firstName', formData.firstName.trim());
      payload.append('lastName', formData.lastName.trim());
      if (formData.personalEmail.trim()) {
        payload.append('personalEmail', formData.personalEmail.trim().toLowerCase());
      } else {
        payload.append('personalEmail', '');
      }
      payload.append('phone', formData.phone.replace(/\D/g, '').slice(-10));
      if (formData.profilePhoto) {
        payload.append('profile_photo', formData.profilePhoto);
      }

      // Step 2: Personal
      payload.append('dateOfBirth', formData.dateOfBirth);
      payload.append('gender', formData.gender);
      payload.append('address', formData.address.trim());
      payload.append('city', formData.city.trim());
      payload.append('state', formData.state.trim());
      payload.append('postalCode', formData.postalCode.trim());
      payload.append('emergencyContactName', formData.emergencyContactName.trim());
      payload.append('emergencyContactPhone', formData.emergencyContactPhone.trim());
      payload.append('emergencyContactRelationship', formData.emergencyContactRelationship.trim());

      // Step 3: Employment
      payload.append('designation', formData.designation.trim());
      payload.append('department', formData.department);
      payload.append('dateOfJoining', formData.dateOfJoining);
      payload.append('employmentType', formData.employmentType);
      if (formData.reportingManager.trim()) {
        payload.append('reportingManager', formData.reportingManager.trim());
      }
      payload.append('workLocation', formData.workLocation.trim());
      payload.append('status', formData.status);
      payload.append('working_days_per_week', formData.workingDaysPerWeek);

      // Step 4: PF
      payload.append('pfNotAvailable', formData.pfNotAvailable ? 'true' : 'false');
      if (!formData.pfNotAvailable) {
        payload.append('uan_number', formData.uanNumber.trim());
        payload.append('pf_number', formData.pfNumber.trim());
        payload.append('pension_number', formData.pensionNumber.trim());
        payload.append('employee_contribution', formData.employeeContribution.trim());
        payload.append('employer_contribution', formData.employerContribution.trim());
      } else {
        payload.append('uan_number', '');
        payload.append('pf_number', '');
        payload.append('pension_number', '');
        payload.append('employee_contribution', '');
        payload.append('employer_contribution', '');
      }

      // Step 5: Bank Details
      payload.append('bankNotAvailable', formData.bankNotAvailable ? 'true' : 'false');
      if (!formData.bankNotAvailable) {
        payload.append('bank_account_holder_name', formData.bankAccountHolderName.trim());
        payload.append('bank_name', formData.bankName.trim());
        payload.append('bank_account_number', formData.bankAccountNumber.trim());
        payload.append('bank_confirm_account_number', formData.bankConfirmAccountNumber.trim());
        payload.append('bank_ifsc_code', formData.bankIfscCode.trim().toUpperCase());
        payload.append('bank_branch_name', formData.bankBranchName.trim());
        payload.append('bank_branch_city', formData.bankBranchCity.trim());
        payload.append('bank_branch_state', formData.bankBranchState.trim());
        payload.append('bank_account_type', formData.bankAccountType);
        payload.append('bank_verification_status', formData.bankVerificationStatus || 'Pending');
      }

      // Step 6: Salary & Payroll
      payload.append('basic_salary', formData.basicSalary);
      payload.append('hra', formData.hra);
      payload.append('allowances', formData.allowances);
      payload.append('pf_employee', formData.pfEmployee);
      payload.append('professional_tax', formData.professionalTax);
      payload.append('other_deductions', formData.otherDeductions);

      // Step 7: Leaves
      payload.append('paid_leave', formData.paidLeave);
      payload.append('sick_leave', formData.sickLeave);
      payload.append('unpaid_leave', formData.unpaidLeave);

      // Step 7: Documents (if new files uploaded)
      if (formData.offerLetter) payload.append('offer_letter', formData.offerLetter);
      if (formData.appointmentLetter) payload.append('appointment_letter', formData.appointmentLetter);
      if (formData.aadhaarCard) payload.append('aadhaar_card', formData.aadhaarCard);
      if (formData.panCard) payload.append('pan_card', formData.panCard);
      if (formData.educationalCertificate) payload.append('educational_certificate', formData.educationalCertificate);
      if (formData.pfDocument) payload.append('pf_document', formData.pfDocument);
      if (formData.otherDocument) payload.append('other_document', formData.otherDocument);

      const res = await api.admin.updateEmployee(employeeId, payload);
      if (res && res.success) {
        setToastMessage('Employee details updated successfully.');
        setTimeout(() => {
          navigate(`/admin/employees/${employeeId}`, {
            state: { message: 'Employee details updated successfully.' }
          });
        }, 1200);
      } else {
        setStepError(res?.message || 'Failed to update employee details.');
      }
    } catch (err) {
      setStepError(err.message || 'An error occurred while saving employee changes.');
    } finally {
      setSubmitting(false);
    }
  };

  const fullName = `${formData.firstName} ${formData.lastName}`.trim() || formData.employeeId;
  const initials = `${formData.firstName?.charAt(0) || ''}${formData.lastName?.charAt(0) || ''}`.toUpperCase() || 'GP';

  // Render Skeleton Loading
  if (loading) {
    return (
      <div className="admin-edit-page">
        <div className="admin-edit-skeleton-card">
          <div className="admin-edit-spinner" />
          <h2 style={{ margin: 0, color: '#0f172a' }}>Loading employee details...</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Retrieving complete records for {employeeId}</p>
        </div>
      </div>
    );
  }

  // Render Error
  if (error && !loading) {
    return (
      <div className="admin-edit-page">
        <div className="admin-edit-skeleton-card">
          <h2 style={{ margin: 0, color: '#dc2626' }}>{error}</h2>
          <p style={{ margin: 0, color: '#64748b' }}>Could not fetch employee record from backend.</p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="admin-edit-btn-secondary"
              onClick={() => navigate('/admin/employees')}
            >
              Back to Employees
            </button>
            <button
              type="button"
              className="admin-edit-btn-primary"
              onClick={loadEmployeeRecord}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-edit-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="admin-edit-toast" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Nav & Header */}
      <div className="admin-edit-header-nav">
        <button
          type="button"
          className="admin-edit-back-btn"
          onClick={handleAttemptExit}
          aria-label="Back to employee details"
        >
          &larr; Back to Employee Details
        </button>

        <div className="admin-edit-header-titles">
          <h1 className="admin-edit-page-title">Edit Employee</h1>
          <p className="admin-edit-page-subtitle">
            Update employee information and employment records.
          </p>
        </div>
      </div>

      {/* Identity Summary Card */}
      <section className="admin-edit-identity-card" aria-label="Employee summary">
        <div className="admin-edit-identity-left">
          <div className="admin-edit-identity-avatar" aria-hidden="true">
            {existingPhotoUrl ? (
              <img src={existingPhotoUrl} alt={`${fullName} avatar`} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className="admin-edit-identity-info">
            <h2 className="admin-edit-identity-name">{fullName}</h2>
            <div className="admin-edit-identity-meta">
              <span className="admin-edit-id-badge">{formData.employeeId}</span>
              <span className="admin-edit-meta-separator">•</span>
              <span className="admin-edit-meta-sub">{formData.designation || '—'}</span>
              <span className="admin-edit-meta-separator">•</span>
              <span className="admin-edit-meta-sub">{formData.department || 'Technology'}</span>
            </div>
          </div>
        </div>

        <div className="admin-edit-identity-right">
          <span className={`admin-edit-status-badge status-${(formData.status || 'ACTIVE').toLowerCase()}`}>
            <span className="status-dot" aria-hidden="true" />
            {formData.status || 'ACTIVE'}
          </span>
        </div>
      </section>

      {/* Step Progress Stepper */}
      <nav className="admin-edit-stepper" aria-label="Edit Wizard Progress">
        {STEPS.map((s) => {
          const isActive = currentStep === s.number;
          const isCompleted = currentStep > s.number;
          return (
            <button
              key={s.number}
              type="button"
              className={`admin-edit-step-btn ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => handleJumpToStep(s.number)}
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="admin-edit-step-circle">
                {isCompleted ? '✓' : s.number}
              </div>
              <span className="admin-edit-step-label">{s.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Step Error Banner */}
      {stepError && (
        <div className="admin-edit-error-banner" role="alert">
          <span>{stepError}</span>
          <button
            type="button"
            onClick={() => setStepError('')}
            style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 'bold' }}
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Main Card Content */}
      <div className="admin-edit-card">
        {/* STEP 1: Basic Information */}
        {currentStep === 1 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 1 — Basic Information</h2>
              <p className="admin-edit-step-desc">
                Official employee identity and personal contact channels.
              </p>
            </div>

            <div className="admin-edit-form-grid">
              {/* Employee ID (Strictly Read-Only) */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-emp-id">
                  <span>Employee ID</span>
                  <span className="admin-edit-readonly-badge">Permanent / Read-Only</span>
                </label>
                <input
                  id="edit-emp-id"
                  name="employeeId"
                  type="text"
                  className="admin-edit-input read-only"
                  value={formData.employeeId}
                  disabled
                  readOnly
                  aria-describedby="emp-id-note"
                />
                <span id="emp-id-note" className="admin-edit-field-note">
                  Employee ID is the unique business key across attendance, payroll, and PF records.
                </span>
              </div>

              {/* Official Email (Read-Only to protect OTP auth consistency) */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-email">
                  <span>Official Email</span>
                  <span className="admin-edit-readonly-badge">Auth Login ID</span>
                </label>
                <input
                  id="edit-email"
                  name="email"
                  type="email"
                  className="admin-edit-input read-only"
                  value={formData.email}
                  disabled
                  readOnly
                  aria-describedby="email-note"
                />
                <span id="email-note" className="admin-edit-field-note">
                  Official email is strictly linked to employee OTP credentials.
                </span>
              </div>

              {/* First Name */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-first-name">
                  <span>First Name <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-first-name"
                  name="firstName"
                  type="text"
                  className="admin-edit-input"
                  value={formData.firstName}
                  onChange={handleChange}
                  placeholder="e.g., Rajeev"
                  required
                />
              </div>

              {/* Last Name */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-last-name">
                  <span>Last Name <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-last-name"
                  name="lastName"
                  type="text"
                  className="admin-edit-input"
                  value={formData.lastName}
                  onChange={handleChange}
                  placeholder="e.g., Appala"
                  required
                />
              </div>

              {/* Personal Email */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-personal-email">
                  <span>Personal Email</span>
                </label>
                <input
                  id="edit-personal-email"
                  name="personalEmail"
                  type="email"
                  className="admin-edit-input"
                  value={formData.personalEmail}
                  onChange={handleChange}
                  placeholder="e.g., rajeev.personal@example.com"
                />
              </div>

              {/* Phone */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-phone">
                  <span>Phone Number (10 Digits) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-phone"
                  name="phone"
                  type="tel"
                  maxLength={10}
                  className="admin-edit-input"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="e.g., 9876543210"
                  required
                />
              </div>

              {/* Replace Profile Photo */}
              <div className="admin-edit-form-group admin-edit-full-width">
                <label className="admin-edit-label" htmlFor="edit-photo">
                  <span>Update Profile Photo (JPEG, PNG, WebP &le; 5 MB)</span>
                </label>
                <div className="admin-edit-upload-box">
                  <div>
                    {formData.profilePhoto ? (
                      <span className="admin-edit-file-pill">
                        📷 {formData.profilePhoto.name}
                        <button
                          type="button"
                          className="admin-edit-file-remove"
                          onClick={() => handleRemoveFile('profilePhoto')}
                        >
                          &times;
                        </button>
                      </span>
                    ) : existingPhotoUrl ? (
                      <span style={{ fontSize: '0.875rem', color: '#475569' }}>
                        Current photo is active. Select a new file to replace it.
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                        No photo currently uploaded. Select an image file.
                      </span>
                    )}
                  </div>
                  <input
                    id="edit-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleFileChange(e, 'profilePhoto')}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* STEP 2: Personal & Contact Details */}
        {currentStep === 2 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 2 — Personal & Contact Information</h2>
              <p className="admin-edit-step-desc">
                Residential address, date of birth, and emergency contacts.
              </p>
            </div>

            <div className="admin-edit-form-grid">
              {/* DOB */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-dob">
                  <span>Date of Birth <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-dob"
                  name="dateOfBirth"
                  type="date"
                  className="admin-edit-input"
                  value={formData.dateOfBirth}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Gender */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-gender">
                  <span>Gender <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-gender"
                  name="gender"
                  className="admin-edit-select"
                  value={formData.gender}
                  onChange={handleChange}
                  required
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Address */}
              <div className="admin-edit-form-group admin-edit-full-width">
                <label className="admin-edit-label" htmlFor="edit-address">
                  <span>Residential Address <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-address"
                  name="address"
                  type="text"
                  className="admin-edit-input"
                  value={formData.address}
                  onChange={handleChange}
                  placeholder="Street / Flat / Door Number"
                  required
                />
              </div>

              {/* City */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-city">
                  <span>City <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-city"
                  name="city"
                  type="text"
                  className="admin-edit-input"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="e.g., Hyderabad"
                  required
                />
              </div>

              {/* State */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-state">
                  <span>State <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-state"
                  name="state"
                  type="text"
                  className="admin-edit-input"
                  value={formData.state}
                  onChange={handleChange}
                  placeholder="e.g., Telangana"
                  required
                />
              </div>

              {/* Postal Code */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-postal">
                  <span>Postal / PIN Code <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-postal"
                  name="postalCode"
                  type="text"
                  className="admin-edit-input"
                  value={formData.postalCode}
                  onChange={handleChange}
                  placeholder="e.g., 500081"
                  required
                />
              </div>

              {/* Emergency Contact Name */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-em-name">
                  <span>Emergency Contact Name <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-em-name"
                  name="emergencyContactName"
                  type="text"
                  className="admin-edit-input"
                  value={formData.emergencyContactName}
                  onChange={handleChange}
                  placeholder="Contact Person Full Name"
                  required
                />
              </div>

              {/* Emergency Contact Phone */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-em-phone">
                  <span>Emergency Contact Phone <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-em-phone"
                  name="emergencyContactPhone"
                  type="tel"
                  className="admin-edit-input"
                  value={formData.emergencyContactPhone}
                  onChange={handleChange}
                  placeholder="e.g., 9876543210"
                  required
                />
              </div>

              {/* Emergency Contact Relationship */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-em-rel">
                  <span>Relationship <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-em-rel"
                  name="emergencyContactRelationship"
                  type="text"
                  className="admin-edit-input"
                  value={formData.emergencyContactRelationship}
                  onChange={handleChange}
                  placeholder="e.g., Spouse / Parent / Sibling"
                  required
                />
              </div>
            </div>
          </>
        )}

        {/* STEP 3: Employment Details */}
        {currentStep === 3 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 3 — Employment Details</h2>
              <p className="admin-edit-step-desc">
                Job title, department, employment category, and work schedule.
              </p>
            </div>

            <div className="admin-edit-form-grid">
              {/* Designation */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-designation">
                  <span>Designation <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-designation"
                  name="designation"
                  className="admin-edit-select"
                  value={formData.designation}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select Designation</option>
                  {ALLOWED_DESIGNATIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {formData.designation && !ALLOWED_DESIGNATIONS.includes(formData.designation) && (
                  <div style={{ marginTop: '4px', fontSize: '12px', color: '#b45309', fontWeight: 500 }}>
                    Current record has legacy designation: &ldquo;{formData.designation}&rdquo;. Please select a valid role.
                  </div>
                )}
              </div>

              {/* Department */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-department">
                  <span>Department <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-department"
                  name="department"
                  className="admin-edit-select"
                  value={formData.department}
                  onChange={handleChange}
                  required
                >
                  {formData.department && !(masterOptions.departments || []).includes(formData.department) && (
                    <option value={formData.department}>{formData.department} (Legacy)</option>
                  )}
                  {(masterOptions.departments || []).map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {/* Date of Joining */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-doj">
                  <span>Date of Joining <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-doj"
                  name="dateOfJoining"
                  type="date"
                  className="admin-edit-input"
                  value={formData.dateOfJoining}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Employment Type */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-emp-type">
                  <span>Employment Type <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-emp-type"
                  name="employmentType"
                  className="admin-edit-select"
                  value={formData.employmentType}
                  onChange={handleChange}
                  required
                >
                  {formData.employmentType && !(masterOptions.employmentTypes || []).includes(formData.employmentType) && (
                    <option value={formData.employmentType}>{formData.employmentType} (Current / Legacy)</option>
                  )}
                  {(masterOptions.employmentTypes || []).map((et) => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </select>
              </div>

              {/* Reporting Manager */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-manager">
                  <span>Reporting Manager</span>
                </label>
                <input
                  id="edit-manager"
                  name="reportingManager"
                  type="text"
                  className="admin-edit-input"
                  value={formData.reportingManager}
                  onChange={handleChange}
                  placeholder="e.g., John Doe"
                />
              </div>

              {/* Work Location */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-location">
                  <span>Work Location <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-location"
                  name="workLocation"
                  type="text"
                  className="admin-edit-input"
                  list="edit-locations-list"
                  value={formData.workLocation}
                  onChange={handleChange}
                  placeholder="e.g., Hyderabad"
                  required
                />
                <datalist id="edit-locations-list">
                  {(masterOptions.locations || []).map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>

              {/* Employee Status */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-status">
                  <span>Employee Status <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-status"
                  name="status"
                  className="admin-edit-select"
                  value={formData.status}
                  onChange={handleChange}
                  required
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="PROBATION">PROBATION</option>
                  <option value="NOTICE_PERIOD">NOTICE_PERIOD</option>
                </select>
              </div>

              {/* Working Days per Week */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-work-days">
                  <span>Working Days per Week <span className="admin-edit-req-star">*</span></span>
                </label>
                <select
                  id="edit-work-days"
                  name="workingDaysPerWeek"
                  className="admin-edit-select"
                  value={formData.workingDaysPerWeek}
                  onChange={handleChange}
                  required
                >
                  <option value="5">5 Days (Monday – Friday)</option>
                  <option value="6">6 Days (Monday – Saturday)</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* STEP 4: PF Details */}
        {currentStep === 4 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 4 — Provident Fund (PF) Details</h2>
              <p className="admin-edit-step-desc">
                Statutory PF and Pension scheme registration information.
              </p>
            </div>

            <div className="admin-edit-form-grid">
              <div className="admin-edit-form-group admin-edit-full-width">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="pfNotAvailable"
                    checked={formData.pfNotAvailable}
                    onChange={handleChange}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#334155' }}>
                    PF is Not Applicable / Not Available for this Employee
                  </span>
                </label>
              </div>

              {!formData.pfNotAvailable && (
                <>
                  {/* UAN Number */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-uan">
                      <span>UAN Number (12 Digits)</span>
                    </label>
                    <input
                      id="edit-uan"
                      name="uanNumber"
                      type="text"
                      maxLength={12}
                      className="admin-edit-input"
                      value={formData.uanNumber}
                      onChange={handleChange}
                      placeholder="e.g., 100912345678"
                    />
                  </div>

                  {/* PF Number */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-pf-num">
                      <span>PF Account Number</span>
                    </label>
                    <input
                      id="edit-pf-num"
                      name="pfNumber"
                      type="text"
                      className="admin-edit-input"
                      value={formData.pfNumber}
                      onChange={handleChange}
                      placeholder="e.g., TS/HYD/0012345/000/0001"
                    />
                  </div>

                  {/* Pension Number */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-pension">
                      <span>Pension Account Number (EPS)</span>
                    </label>
                    <input
                      id="edit-pension"
                      name="pensionNumber"
                      type="text"
                      className="admin-edit-input"
                      value={formData.pensionNumber}
                      onChange={handleChange}
                      placeholder="Optional pension registration"
                    />
                  </div>

                  {/* Employee Contribution (₹) */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-employee-contrib">
                      <span>Employee Contribution (₹)</span>
                    </label>
                    <input
                      id="edit-employee-contrib"
                      name="employeeContribution"
                      type="number"
                      step="0.01"
                      min="0"
                      className="admin-edit-input"
                      value={formData.employeeContribution}
                      onChange={handleChange}
                      placeholder="e.g., 1800.00"
                    />
                  </div>

                  {/* Employer Contribution (₹) */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-employer-contrib">
                      <span>Employer Contribution (₹)</span>
                    </label>
                    <input
                      id="edit-employer-contrib"
                      name="employerContribution"
                      type="number"
                      step="0.01"
                      min="0"
                      className="admin-edit-input"
                      value={formData.employerContribution}
                      onChange={handleChange}
                      placeholder="e.g., 1800.00"
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* STEP 5: Bank Details */}
        {currentStep === 5 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 5 — Bank Details</h2>
              <p className="admin-edit-step-desc">
                Disbursement account details for salary processing. IDFC Bank is configured as default for new accounts.
              </p>
            </div>

            <div className="admin-edit-form-grid">
              <div className="admin-edit-form-group admin-edit-full-width">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name="bankNotAvailable"
                    checked={formData.bankNotAvailable}
                    onChange={handleChange}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#334155' }}>
                    Bank details not available / defer configuration
                  </span>
                </label>
              </div>

              {!formData.bankNotAvailable && (
                <>
                  {/* Account Holder Name */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-holder">
                      <span>Account Holder Name <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <input
                      id="edit-bank-holder"
                      name="bankAccountHolderName"
                      type="text"
                      className="admin-edit-input"
                      value={formData.bankAccountHolderName}
                      onChange={handleChange}
                      placeholder="e.g., Rajeev Appala"
                      required
                    />
                  </div>

                  {/* Bank Name */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-name">
                      <span>Bank Name <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <select
                      id="edit-bank-name"
                      name="bankName"
                      className="admin-edit-select"
                      value={formData.bankName}
                      onChange={handleChange}
                      required
                    >
                      {formData.bankName && !APPROVED_BANKS.includes(formData.bankName) && (
                        <option value={formData.bankName}>{formData.bankName} (Current)</option>
                      )}
                      {APPROVED_BANKS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  {/* Account Number */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-acc-num">
                      <span>Account Number <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <input
                      id="edit-bank-acc-num"
                      name="bankAccountNumber"
                      type="text"
                      className="admin-edit-input font-mono"
                      value={formData.bankAccountNumber}
                      onChange={handleChange}
                      placeholder="Enter 9 to 18 digit account number"
                      required
                    />
                    {formData.bankAccountNumber.includes('•') ? (
                      <span className="admin-edit-field-note">
                        Account number is currently encrypted and masked. Enter a new number only to update it.
                      </span>
                    ) : (
                      <span className="admin-edit-field-note">
                        9 to 18 numeric digits. Will be encrypted using AES-256-GCM.
                      </span>
                    )}
                  </div>

                  {/* Confirm Account Number */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-confirm-acc">
                      <span>Confirm Account Number <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <input
                      id="edit-bank-confirm-acc"
                      name="bankConfirmAccountNumber"
                      type="text"
                      className="admin-edit-input font-mono"
                      value={formData.bankConfirmAccountNumber}
                      onChange={handleChange}
                      placeholder="Re-enter account number"
                      required
                      style={isEditBankMismatch ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : {}}
                      aria-invalid={isEditBankMismatch}
                      aria-describedby={isEditBankMismatch ? 'editBankConfirmMismatchError' : undefined}
                    />
                    {isEditBankMismatch && (
                      <span
                        id="editBankConfirmMismatchError"
                        className="admin-edit-field-error"
                        style={{
                          display: 'block',
                          color: '#ef4444',
                          fontSize: '0.8125rem',
                          marginTop: '0.375rem',
                          fontWeight: 500,
                        }}
                        role="alert"
                      >
                        Account numbers do not match.
                      </span>
                    )}
                  </div>

                  {/* IFSC Code */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-ifsc">
                      <span>IFSC Code <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <input
                      id="edit-bank-ifsc"
                      name="bankIfscCode"
                      type="text"
                      maxLength={11}
                      className="admin-edit-input font-mono"
                      value={formData.bankIfscCode}
                      onChange={(e) => {
                        setStepError('');
                        setFormData((prev) => ({
                          ...prev,
                          bankIfscCode: e.target.value.toUpperCase(),
                        }));
                      }}
                      placeholder="e.g., IDFB0001001"
                      required
                    />
                  </div>

                  {/* Account Type */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-acc-type">
                      <span>Account Type <span className="admin-edit-req-star">*</span></span>
                    </label>
                    <select
                      id="edit-bank-acc-type"
                      name="bankAccountType"
                      className="admin-edit-select"
                      value={formData.bankAccountType}
                      onChange={handleChange}
                      required
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Branch Name */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-branch">
                      <span>Branch Name</span>
                    </label>
                    <input
                      id="edit-bank-branch"
                      name="bankBranchName"
                      type="text"
                      className="admin-edit-input"
                      value={formData.bankBranchName}
                      onChange={handleChange}
                      placeholder="e.g., Hitec City"
                    />
                  </div>

                  {/* Branch City */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-city">
                      <span>Branch City</span>
                    </label>
                    <input
                      id="edit-bank-city"
                      name="bankBranchCity"
                      type="text"
                      className="admin-edit-input"
                      value={formData.bankBranchCity}
                      onChange={handleChange}
                      placeholder="e.g., Hyderabad"
                    />
                  </div>

                  {/* Branch State */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-state">
                      <span>Branch State</span>
                    </label>
                    <input
                      id="edit-bank-state"
                      name="bankBranchState"
                      type="text"
                      className="admin-edit-input"
                      value={formData.bankBranchState}
                      onChange={handleChange}
                      placeholder="e.g., Telangana"
                    />
                  </div>

                  {/* Verification Status */}
                  <div className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor="edit-bank-status">
                      <span>Verification Status</span>
                    </label>
                    <select
                      id="edit-bank-status"
                      name="bankVerificationStatus"
                      className="admin-edit-select"
                      value={formData.bankVerificationStatus}
                      onChange={handleChange}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Verified">Verified</option>
                      <option value="Rejected">Rejected</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* STEP 6: Salary & Payroll */}
        {currentStep === 6 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 6 — Salary Structure & Payroll Profile</h2>
              <p className="admin-edit-step-desc">
                Recurring monthly compensation profile. Updates apply to future payroll cycles without modifying finalized historical payslips.
              </p>
            </div>

            {/* Calculations Banner */}
            <div className="admin-edit-calc-banner" aria-label="Salary calculation summary">
              <div>
                <div className="admin-edit-calc-stat-label">Gross Monthly Pay</div>
                <div className="admin-edit-calc-stat-val">
                  ₹{salaryCalculations.gross.toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div className="admin-edit-calc-stat-label">Total Monthly Deductions</div>
                <div className="admin-edit-calc-stat-val deductions">
                  ₹{salaryCalculations.deductions.toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div className="admin-edit-calc-stat-label">Estimated Net Monthly Salary</div>
                <div className="admin-edit-calc-stat-val net-pay">
                  ₹{salaryCalculations.net.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div className="admin-edit-form-grid grid-3">
              {/* Basic Salary */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-basic">
                  <span>Basic Salary (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-basic"
                  name="basicSalary"
                  type="number"
                  min="0"
                  step="100"
                  className="admin-edit-input"
                  value={formData.basicSalary}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* HRA */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-hra">
                  <span>HRA (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-hra"
                  name="hra"
                  type="number"
                  min="0"
                  step="100"
                  className="admin-edit-input"
                  value={formData.hra}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Allowances */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-allowances">
                  <span>Special Allowances (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-allowances"
                  name="allowances"
                  type="number"
                  min="0"
                  step="100"
                  className="admin-edit-input"
                  value={formData.allowances}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* PF Employee Deduction */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-pf-deduct">
                  <span>Employee PF (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-pf-deduct"
                  name="pfEmployee"
                  type="number"
                  min="0"
                  step="50"
                  className="admin-edit-input"
                  value={formData.pfEmployee}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Professional Tax */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-pt">
                  <span>Professional Tax (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-pt"
                  name="professionalTax"
                  type="number"
                  min="0"
                  step="50"
                  className="admin-edit-input"
                  value={formData.professionalTax}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Other Deductions */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-other-deduct">
                  <span>Other Deductions (₹) <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-other-deduct"
                  name="otherDeductions"
                  type="number"
                  min="0"
                  step="50"
                  className="admin-edit-input"
                  value={formData.otherDeductions}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          </>
        )}

        {/* STEP 7: Leave Setup */}
        {currentStep === 7 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 7 — Leave Balances & Configuration</h2>
              <p className="admin-edit-step-desc">
                Current annual entitlement balances. Historical leave requests and logs are preserved.
              </p>
            </div>

            <div className="admin-edit-form-grid grid-3">
              {/* Paid Leave (PL) */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-pl">
                  <span>Paid Leave (PL) Balance <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-pl"
                  name="paidLeave"
                  type="number"
                  min="0"
                  step="0.5"
                  className="admin-edit-input"
                  value={formData.paidLeave}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Sick Leave (SL) */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-sl">
                  <span>Sick Leave (SL) Balance <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-sl"
                  name="sickLeave"
                  type="number"
                  min="0"
                  step="0.5"
                  className="admin-edit-input"
                  value={formData.sickLeave}
                  onChange={handleChange}
                  required
                />
              </div>

              {/* Unpaid Leave (UPL) */}
              <div className="admin-edit-form-group">
                <label className="admin-edit-label" htmlFor="edit-upl">
                  <span>Unpaid Leave (UPL) Taken <span className="admin-edit-req-star">*</span></span>
                </label>
                <input
                  id="edit-upl"
                  name="unpaidLeave"
                  type="number"
                  min="0"
                  step="0.5"
                  className="admin-edit-input"
                  value={formData.unpaidLeave}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
          </>
        )}

        {/* STEP 8: Documents */}
        {currentStep === 8 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 8 — Employee Documents</h2>
              <p className="admin-edit-step-desc">
                Inspect existing onboarding records and attach replacements or missing documents.
              </p>
            </div>

            {/* Existing Documents List */}
            <div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>
                Existing Uploaded Documents ({existingDocuments.length})
              </h3>

              {existingDocuments.length === 0 ? (
                <div className="admin-edit-no-diff">
                  No existing documents recorded for this employee.
                </div>
              ) : (
                <div className="admin-edit-docs-list">
                  {existingDocuments.map((doc) => (
                    <div key={doc.id} className="admin-edit-doc-row">
                      <div className="admin-edit-doc-left">
                        <div className="admin-edit-doc-icon" aria-hidden="true">
                          📄
                        </div>
                        <div className="admin-edit-doc-meta">
                          <span className="admin-edit-doc-name">
                            {doc.document_type || doc.file_name}
                          </span>
                          <span className="admin-edit-doc-sub">
                            {doc.file_name} • Uploaded {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-GB') : 'on file'}
                          </span>
                        </div>
                      </div>

                      <div className="admin-edit-doc-actions">
                        <button
                          type="button"
                          className="admin-edit-doc-btn"
                          onClick={() => handlePreviewDoc(doc)}
                          aria-label={`View ${doc.document_type || doc.file_name}`}
                        >
                          👁️ View
                        </button>
                        <button
                          type="button"
                          className="admin-edit-doc-btn"
                          onClick={() => handleDownloadDoc(doc)}
                          aria-label={`Download ${doc.document_type || doc.file_name}`}
                        >
                          ⬇️ Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upload or Replace Section */}
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>
                Upload or Replace Documents (PDF, PNG, JPEG &le; 10 MB)
              </h3>

              <div className="admin-edit-form-grid">
                {[
                  { field: 'offerLetter', label: 'Offer Letter' },
                  { field: 'appointmentLetter', label: 'Appointment Letter' },
                  { field: 'aadhaarCard', label: 'Aadhaar Card' },
                  { field: 'panCard', label: 'PAN Card' },
                  { field: 'educationalCertificate', label: 'Educational Certificate' },
                  { field: 'pfDocument', label: 'PF Document' },
                  { field: 'otherDocument', label: 'Other Document' },
                ].map(({ field, label }) => (
                  <div key={field} className="admin-edit-form-group">
                    <label className="admin-edit-label" htmlFor={`upload-${field}`}>
                      <span>{label}</span>
                    </label>
                    <div className="admin-edit-upload-box">
                      <div>
                        {formData[field] ? (
                          <span className="admin-edit-file-pill">
                            📄 {formData[field].name}
                            <button
                              type="button"
                              className="admin-edit-file-remove"
                              onClick={() => handleRemoveFile(field)}
                            >
                              &times;
                            </button>
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                            Choose file to upload / replace
                          </span>
                        )}
                      </div>
                      <input
                        id={`upload-${field}`}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        onChange={(e) => handleFileChange(e, field)}
                        style={{ fontSize: '0.8125rem' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* STEP 9: Review Changes */}
        {currentStep === 9 && (
          <>
            <div className="admin-edit-step-header">
              <h2 className="admin-edit-step-title">Step 9 — Review & Confirm Changes</h2>
              <p className="admin-edit-step-desc">
                Verify all modifications before committing updates to the database.
              </p>
            </div>

            <div className="admin-edit-review-summary">
              {/* Highlight Modified Fields */}
              <div className="admin-edit-diff-box">
                <h3 className="admin-edit-diff-title">
                  <span>Modifications Summary ({modifiedFields.length})</span>
                </h3>

                {modifiedFields.length === 0 ? (
                  <div className="admin-edit-no-diff">
                    No field values have been modified. Saving will keep current employee records unchanged.
                  </div>
                ) : (
                  <div className="admin-edit-diff-grid">
                    {modifiedFields.map((diff) => (
                      <div key={diff.key} className="admin-edit-diff-card">
                        <div className="admin-edit-diff-label">{diff.label}</div>
                        <div className="admin-edit-diff-vals">
                          <span className="admin-edit-old-val">{diff.oldValue}</span>
                          <span>&rarr;</span>
                          <span className="admin-edit-new-val">{diff.newValue}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Complete Snapshot */}
              <div className="admin-edit-review-section">
                <div className="admin-edit-review-section-header">
                  Basic & Personal Information
                </div>
                <div className="admin-edit-review-grid">
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Employee ID</span>
                    <span className="admin-edit-review-item-val">{formData.employeeId}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Full Name</span>
                    <span className="admin-edit-review-item-val">{fullName}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Official Email</span>
                    <span className="admin-edit-review-item-val">{formData.email}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Phone</span>
                    <span className="admin-edit-review-item-val">{formData.phone}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">DOB</span>
                    <span className="admin-edit-review-item-val">{formData.dateOfBirth}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Residential City / State</span>
                    <span className="admin-edit-review-item-val">{formData.city}, {formData.state}</span>
                  </div>
                </div>
              </div>

              <div className="admin-edit-review-section">
                <div className="admin-edit-review-section-header">
                  Employment & Schedule
                </div>
                <div className="admin-edit-review-grid">
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Designation</span>
                    <span className="admin-edit-review-item-val">{formData.designation}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Department</span>
                    <span className="admin-edit-review-item-val">{formData.department}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Date of Joining</span>
                    <span className="admin-edit-review-item-val">{formData.dateOfJoining}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Employment Type</span>
                    <span className="admin-edit-review-item-val">{formData.employmentType}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Status</span>
                    <span className="admin-edit-review-item-val">{formData.status}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Working Days / Week</span>
                    <span className="admin-edit-review-item-val">{formData.workingDaysPerWeek} Days</span>
                  </div>
                </div>
              </div>

              <div className="admin-edit-review-section">
                <div className="admin-edit-review-section-header">
                  Compensation & Leaves
                </div>
                <div className="admin-edit-review-grid">
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Gross Salary</span>
                    <span className="admin-edit-review-item-val">₹{salaryCalculations.gross.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Total Deductions</span>
                    <span className="admin-edit-review-item-val">₹{salaryCalculations.deductions.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Net Monthly Salary</span>
                    <span className="admin-edit-review-item-val">₹{salaryCalculations.net.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Paid Leave (PL)</span>
                    <span className="admin-edit-review-item-val">{formData.paidLeave} Days</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Sick Leave (SL)</span>
                    <span className="admin-edit-review-item-val">{formData.sickLeave} Days</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">PF Status</span>
                    <span className="admin-edit-review-item-val">
                      {formData.pfNotAvailable ? 'Not Applicable' : (formData.uanNumber ? `UAN: ${formData.uanNumber}` : 'Configured')}
                    </span>
                  </div>
                  {!formData.pfNotAvailable && (
                    <>
                      <div className="admin-edit-review-item">
                        <span className="admin-edit-review-item-label">PF Employee Contribution</span>
                        <span className="admin-edit-review-item-val">
                          {formData.employeeContribution ? `₹${parseFloat(formData.employeeContribution).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Not configured'}
                        </span>
                      </div>
                      <div className="admin-edit-review-item">
                        <span className="admin-edit-review-item-label">PF Employer Contribution</span>
                        <span className="admin-edit-review-item-val">
                          {formData.employerContribution ? `₹${parseFloat(formData.employerContribution).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Not configured'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="admin-edit-review-section">
                <div className="admin-edit-review-section-header">
                  Bank Details
                </div>
                <div className="admin-edit-review-grid">
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Bank Status</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? 'Not Configured' : 'Configured'}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Bank Name</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankName || 'IDFC Bank')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Account Holder</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankAccountHolderName || '—')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Account Number</span>
                    <span className="admin-edit-review-item-val">
                      {formData.bankNotAvailable ? '—' : (
                        formData.bankAccountNumber.includes('•')
                          ? formData.bankAccountNumber
                          : (formData.bankAccountNumber ? `••••••••${formData.bankAccountNumber.slice(-4)}` : '—')
                      )}
                    </span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">IFSC Code</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankIfscCode || '—')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Account Type</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankAccountType || 'Savings')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Branch</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankBranchName || '—')}</span>
                  </div>
                  <div className="admin-edit-review-item">
                    <span className="admin-edit-review-item-label">Verification Status</span>
                    <span className="admin-edit-review-item-val">{formData.bankNotAvailable ? '—' : (formData.bankVerificationStatus || 'Pending')}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Wizard Footer Actions */}
        <div className="admin-edit-actions-bar">
          <div className="admin-edit-btn-group">
            <button
              type="button"
              className="admin-edit-btn-secondary"
              onClick={handleAttemptExit}
              disabled={submitting}
            >
              Cancel
            </button>
            {currentStep > 1 && (
              <button
                type="button"
                className="admin-edit-btn-secondary"
                onClick={handleBack}
                disabled={submitting}
              >
                &larr; Previous
              </button>
            )}
          </div>

          <div className="admin-edit-btn-group">
            {currentStep < 9 ? (
              <button
                type="button"
                className="admin-edit-btn-primary"
                onClick={handleNext}
                disabled={submitting || (currentStep === 5 && isEditBankMismatch)}
              >
                Next &rarr;
              </button>
            ) : (
              <button
                type="button"
                className="admin-edit-btn-primary admin-edit-btn-save"
                onClick={handleSave}
                disabled={submitting || isEditBankMismatch}
              >
                {submitting ? 'Saving Changes...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Modal */}
      {showExitModal && (
        <div className="admin-edit-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-edit-modal-box">
            <h3 className="admin-edit-modal-title">Unsaved Changes</h3>
            <p className="admin-edit-modal-desc">
              You have unsaved changes. Are you sure you want to leave? Any modifications will be lost.
            </p>
            <div className="admin-edit-modal-footer">
              <button
                type="button"
                className="admin-edit-btn-secondary"
                onClick={() => setShowExitModal(false)}
              >
                Continue Editing
              </button>
              <button
                type="button"
                className="admin-edit-btn-primary admin-edit-discard-btn"
                onClick={handleConfirmDiscard}
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      {previewDocModal && (
        <div className="admin-edit-modal-overlay" role="dialog" aria-modal="true">
          <div className="admin-edit-modal-box admin-edit-preview-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="admin-edit-modal-title" style={{ margin: 0 }}>
                {previewDocModal.document_type || previewDocModal.file_name}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewDocModal(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}
              >
                &times;
              </button>
            </div>

            <div className="admin-edit-preview-body">
              {previewLoading ? (
                <div className="admin-edit-spinner" />
              ) : previewBlobUrl ? (
                <iframe
                  src={previewBlobUrl}
                  title="Document Preview"
                />
              ) : (
                <p>Preview not available.</p>
              )}
            </div>

            <div className="admin-edit-modal-footer">
              <button
                type="button"
                className="admin-edit-btn-secondary"
                onClick={() => setPreviewDocModal(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="admin-edit-btn-primary"
                onClick={() => handleDownloadDoc(previewDocModal)}
              >
                Download File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
