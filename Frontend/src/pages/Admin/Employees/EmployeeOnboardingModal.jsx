import { useState, useMemo, useEffect } from 'react';
import api from '../../../services/api';
import './EmployeeOnboardingModal.css';

const INITIAL_WIZARD_DATA = {
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
  dateOfJoining: new Date().toISOString().split('T')[0],
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

  // Step 8: Documents
  offerLetter: null,
  appointmentLetter: null,
  aadhaarCard: null,
  panCard: null,
  educationalCertificate: null,
  pfDocument: null,
  otherDocument: null,
};

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

function EmployeeOnboardingModal({ isOpen, onClose, onSuccess }) {
  const [userType, setUserType] = useState('Employee');
  const [adminForm, setAdminForm] = useState({
    adminId: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  const [adminFieldErrors, setAdminFieldErrors] = useState({});
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(INITIAL_WIZARD_DATA);
  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [masterOptions, setMasterOptions] = useState({
    departments: ['IT', 'Non-IT'],
    designations: ['Senior Tech Lead', 'Python Developer', 'Software Engineer', 'Product Manager', 'QA Engineer', 'HR Manager'],
    employmentTypes: ['Full Time', 'Part Time', 'Contract', 'Intern'],
    locations: ['Hyderabad', 'Hyderabad HQ', 'Bangalore', 'Mumbai', 'Pune', 'Remote'],
  });

  useEffect(() => {
    let isMounted = true;
    api.admin.settings.employees.get()
      .then((res) => {
        if (isMounted && res?.success && res.data) {
          const depts = (res.data.departments || []).filter((d) => d.is_active).map((d) => d.name);
          const desigs = (res.data.designations || []).filter((d) => d.is_active).map((d) => d.name);
          const empTypes = (res.data.employmentTypes || []).filter((e) => e.is_active).map((e) => e.name);
          const locs = (res.data.locations || []).filter((l) => l.is_active).map((l) => l.name);

          setMasterOptions((prev) => ({
            departments: depts.length > 0 ? depts : prev.departments,
            designations: desigs.length > 0 ? desigs : prev.designations,
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

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setStepError('');
    setAdminFieldErrors((prev) => ({ ...prev, [name]: '' }));
    setAdminForm((prev) => ({
      ...prev,
      [name]: name === 'adminId' ? value.toUpperCase() : value,
    }));
  };

  const handleCreateAdmin = async (e) => {
    if (e) e.preventDefault();
    setStepError('');
    const errors = {};

    const trimmedAdminId = (adminForm.adminId || '').trim().toUpperCase();
    if (!trimmedAdminId) {
      errors.adminId = 'Admin ID Number is required.';
    } else if (trimmedAdminId.length < 2 || trimmedAdminId.length > 30) {
      errors.adminId = 'Admin ID Number must be between 2 and 30 characters.';
    } else if (!/^[A-Z0-9\-_/]+$/.test(trimmedAdminId)) {
      errors.adminId = 'Admin ID Number may only contain letters, numbers, hyphens, slashes, and underscores.';
    }

    if (!adminForm.firstName.trim()) {
      errors.firstName = 'First name is required.';
    }
    if (!adminForm.lastName.trim()) {
      errors.lastName = 'Last name is required.';
    }
    if (!adminForm.email.trim()) {
      errors.email = 'Email address is required.';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(adminForm.email.trim().toLowerCase())) {
        errors.email = 'Invalid email address format.';
      }
    }
    if (adminForm.phone && adminForm.phone.trim()) {
      if (!/^[0-9+()\- ]{7,20}$/.test(adminForm.phone.trim())) {
        errors.phone = 'Invalid phone number format.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setAdminFieldErrors(errors);
      setStepError('Please correct the validation errors below.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.admin.createUser({
        role: 'ADMIN',
        userType: 'Admin',
        adminId: trimmedAdminId,
        firstName: adminForm.firstName.trim(),
        lastName: adminForm.lastName.trim(),
        email: adminForm.email.trim().toLowerCase(),
        phone: adminForm.phone.trim() || undefined,
      });

      if (res && res.success) {
        onSuccess(null, 'Administrator account created successfully.');
        onClose();
      } else {
        setStepError(res?.message || 'Failed to create administrator account.');
      }
    } catch (err) {
      const errMsg = err.message || 'An error occurred while creating administrator.';
      setStepError(errMsg);
      if (errMsg.toLowerCase().includes('admin id')) {
        setAdminFieldErrors((prev) => ({ ...prev, adminId: errMsg }));
      } else if (errMsg.toLowerCase().includes('email')) {
        setAdminFieldErrors((prev) => ({ ...prev, email: errMsg }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Calculations for Step 5 & Step 8
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

    return {
      gross,
      deductions,
      net,
    };
  }, [
    formData.basicSalary,
    formData.hra,
    formData.allowances,
    formData.pfEmployee,
    formData.professionalTax,
    formData.otherDeductions,
  ]);

  if (!isOpen) return null;

  const bankAccTrimmed = (formData.bankAccountNumber || '').trim();
  const bankConfirmTrimmed = (formData.bankConfirmAccountNumber || '').trim();
  const isBankMismatch = !formData.bankNotAvailable &&
    Boolean(bankConfirmTrimmed) &&
    bankAccTrimmed !== bankConfirmTrimmed;

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

  // Validate the current step before advancing
  const validateStep = (stepNumber) => {
    setStepError('');

    if (stepNumber === 1) {
      const empId = (formData.employeeId || '').trim().toUpperCase();
      if (!empId) {
        setStepError('Employee ID is required.');
        return false;
      }
      if (!/^GP[0-9]{4}N$/.test(empId)) {
        setStepError('Invalid Employee ID format. Expected format: GP followed by 4 digits and N (e.g., GP0025N).');
        return false;
      }
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
      if (!formData.pfNotAvailable && formData.uanNumber.trim()) {
        const uan = formData.uanNumber.trim();
        if (!/^\d{12}$/.test(uan)) {
          setStepError('UAN number must be exactly 12 numeric digits.');
          return false;
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
        if (!formData.bankAccountNumber.trim()) {
          setStepError('Account number is required.');
          return false;
        }
        if (!/^\d{9,18}$/.test(formData.bankAccountNumber.trim())) {
          setStepError('Invalid account number. Account number must contain 9 to 18 digits.');
          return false;
        }
        if (!formData.bankConfirmAccountNumber.trim()) {
          setStepError('Please confirm the account number.');
          return false;
        }
        if (formData.bankAccountNumber.trim() !== formData.bankConfirmAccountNumber.trim()) {
          setStepError('Account numbers do not match. Please verify and re-enter.');
          return false;
        }
        if (!formData.bankIfscCode.trim()) {
          setStepError('IFSC code is required.');
          return false;
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(formData.bankIfscCode.trim().toUpperCase())) {
          setStepError('Invalid IFSC code format (e.g., IDFB0001234).');
          return false;
        }
        if (!['Savings', 'Current', 'Salary'].includes(formData.bankAccountType)) {
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
    }
  };

  const handleBack = () => {
    setStepError('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleJumpToStep = (targetStep) => {
    setStepError('');
    setCurrentStep(targetStep);
  };

  // Submit complete onboarding
  const handleSubmit = async () => {
    // Final verification across all steps (steps 1 through 7)
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
      const sanitizedEmpId = formData.employeeId.trim().toUpperCase();

      // Step 1
      payload.append('employee_id', sanitizedEmpId);
      payload.append('firstName', formData.firstName.trim());
      payload.append('lastName', formData.lastName.trim());
      payload.append('email', formData.email.trim().toLowerCase());
      if (formData.personalEmail.trim()) {
        payload.append('personalEmail', formData.personalEmail.trim().toLowerCase());
      }
      payload.append('phone', formData.phone.replace(/\D/g, '').slice(-10));
      if (formData.profilePhoto) {
        payload.append('profile_photo', formData.profilePhoto);
      }

      // Step 2
      payload.append('dateOfBirth', formData.dateOfBirth);
      payload.append('gender', formData.gender);
      payload.append('address', formData.address.trim());
      payload.append('city', formData.city.trim());
      payload.append('state', formData.state.trim());
      payload.append('postalCode', formData.postalCode.trim());
      payload.append('emergencyContactName', formData.emergencyContactName.trim());
      payload.append('emergencyContactPhone', formData.emergencyContactPhone.trim());
      payload.append('emergencyContactRelationship', formData.emergencyContactRelationship.trim());

      // Step 3
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

      // Step 4
      payload.append('pfNotAvailable', formData.pfNotAvailable ? 'true' : 'false');
      if (!formData.pfNotAvailable) {
        payload.append('uan_number', formData.uanNumber.trim());
        payload.append('pf_number', formData.pfNumber.trim());
        payload.append('pension_number', formData.pensionNumber.trim());
      }

      // Step 5: Bank Details
      payload.append('bankNotAvailable', formData.bankNotAvailable ? 'true' : 'false');
      if (!formData.bankNotAvailable) {
        payload.append('bank_account_holder_name', formData.bankAccountHolderName.trim());
        payload.append('bank_name', formData.bankName.trim() || 'IDFC Bank');
        payload.append('bank_account_number', formData.bankAccountNumber.trim());
        payload.append('bank_confirm_account_number', formData.bankConfirmAccountNumber.trim());
        payload.append('bank_ifsc_code', formData.bankIfscCode.trim().toUpperCase());
        if (formData.bankBranchName.trim()) payload.append('bank_branch_name', formData.bankBranchName.trim());
        if (formData.bankBranchCity.trim()) payload.append('bank_branch_city', formData.bankBranchCity.trim());
        if (formData.bankBranchState.trim()) payload.append('bank_branch_state', formData.bankBranchState.trim());
        payload.append('bank_account_type', formData.bankAccountType);
      }

      // Step 6: Salary
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

      // Step 8: Documents
      if (formData.offerLetter) payload.append('offer_letter', formData.offerLetter);
      if (formData.appointmentLetter) payload.append('appointment_letter', formData.appointmentLetter);
      if (formData.aadhaarCard) payload.append('aadhaar_card', formData.aadhaarCard);
      if (formData.panCard) payload.append('pan_card', formData.panCard);
      if (formData.educationalCertificate) payload.append('educational_certificate', formData.educationalCertificate);
      if (formData.pfDocument) payload.append('pf_document', formData.pfDocument);
      if (formData.otherDocument) payload.append('other_document', formData.otherDocument);

      const res = await api.admin.onboardEmployee(payload);
      if (res && res.success) {
        onSuccess(sanitizedEmpId);
        onClose();
      } else {
        setStepError(res?.message || 'Failed to onboard employee.');
      }
    } catch (err) {
      setStepError(err.message || 'An error occurred during onboarding.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wizard-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wizard-modal-title">
      <div className="wizard-modal-container">
        {/* Wizard Header */}
        <div className="wizard-modal-header">
          <div className="wizard-title-block">
            <h2 id="wizard-modal-title" className="wizard-modal-title">
              {userType === 'Admin' ? 'Create Administrator Account' : 'Employee Onboarding Wizard'}
            </h2>
            <p className="wizard-modal-subtitle">
              {userType === 'Admin'
                ? 'Provide administrator account details'
                : userType === 'Employee'
                ? `Step ${currentStep} of 8: ${STEPS[currentStep - 1].label}`
                : 'Select user type to proceed'}
            </p>
          </div>
          <button
            type="button"
            className="wizard-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            disabled={submitting}
          >
            &times;
          </button>
        </div>

        {/* User Type Selection Bar */}
        <div
          className="wizard-user-type-bar"
          style={{
            padding: '0.875rem 1.75rem',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor="userTypeSelect" style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1e293b' }}>
            User Type <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <select
            id="userTypeSelect"
            value={userType}
            onChange={(e) => {
              setUserType(e.target.value);
              setStepError('');
            }}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              minWidth: '220px',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              cursor: 'pointer',
            }}
          >
            <option value="">Select user type</option>
            <option value="Employee">Employee</option>
            <option value="Admin">Admin</option>
          </select>
        </div>

        {/* Wizard Stepper Bar (Only for Employee) */}
        {userType === 'Employee' && (
          <div className="wizard-stepper" role="navigation" aria-label="Onboarding Steps">
            {STEPS.map((s) => {
              const isCompleted = s.number < currentStep;
              const isActive = s.number === currentStep;
              return (
                <button
                  key={s.number}
                  type="button"
                  className={`wizard-step-node ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                  onClick={() => handleJumpToStep(s.number)}
                  disabled={submitting}
                  aria-current={isActive ? 'step' : undefined}
                  title={`Step ${s.number}: ${s.label}`}
                >
                  <div className="step-node-badge">
                    {isCompleted ? '✓' : s.number}
                  </div>
                  <span className="step-node-text">{s.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Error Alert Banner */}
        {stepError && (
          <div className="wizard-alert-banner" role="alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{stepError}</span>
          </div>
        )}

        {/* Wizard Content Body */}
        <div className="wizard-modal-body">
          {/* Admin Account Creation Form */}
          {userType === 'Admin' && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Administrator Details</h3>
              <p className="wizard-section-desc">
                Provide administrator credentials. Administrators manage employee records and access the portal securely using OTP.
              </p>
              <div className="wizard-form-grid">
                <div className="wizard-field-group wizard-field-full">
                  <label htmlFor="adminId" className="wizard-field-label">
                    Admin ID Number <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    id="adminId"
                    name="adminId"
                    className="wizard-field-input"
                    placeholder="e.g. ADM0001"
                    value={adminForm.adminId}
                    onChange={handleAdminChange}
                    maxLength={30}
                    autoComplete="off"
                    style={adminFieldErrors.adminId ? { borderColor: '#ef4444' } : {}}
                  />
                  {adminFieldErrors.adminId && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      {adminFieldErrors.adminId}
                    </span>
                  )}
                  <small style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                    Unique administrator ID number (letters, numbers, hyphens, slashes, and underscores).
                  </small>
                </div>

                <div className="wizard-field-group">
                  <label htmlFor="adminFirstName" className="wizard-field-label">
                    First Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    id="adminFirstName"
                    name="firstName"
                    className="wizard-field-input"
                    placeholder="Enter first name"
                    value={adminForm.firstName}
                    onChange={handleAdminChange}
                    maxLength={50}
                    style={adminFieldErrors.firstName ? { borderColor: '#ef4444' } : {}}
                  />
                  {adminFieldErrors.firstName && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      {adminFieldErrors.firstName}
                    </span>
                  )}
                </div>

                <div className="wizard-field-group">
                  <label htmlFor="adminLastName" className="wizard-field-label">
                    Last Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    id="adminLastName"
                    name="lastName"
                    className="wizard-field-input"
                    placeholder="Enter last name"
                    value={adminForm.lastName}
                    onChange={handleAdminChange}
                    maxLength={50}
                    style={adminFieldErrors.lastName ? { borderColor: '#ef4444' } : {}}
                  />
                  {adminFieldErrors.lastName && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      {adminFieldErrors.lastName}
                    </span>
                  )}
                </div>

                <div className="wizard-field-group wizard-field-full">
                  <label htmlFor="adminEmail" className="wizard-field-label">
                    Email Address <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    id="adminEmail"
                    name="email"
                    className="wizard-field-input"
                    placeholder="Enter email address"
                    value={adminForm.email}
                    onChange={handleAdminChange}
                    style={adminFieldErrors.email ? { borderColor: '#ef4444' } : {}}
                  />
                  {adminFieldErrors.email && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      {adminFieldErrors.email}
                    </span>
                  )}
                </div>

                <div className="wizard-field-group">
                  <label htmlFor="adminPhone" className="wizard-field-label">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="adminPhone"
                    name="phone"
                    className="wizard-field-input"
                    placeholder="Enter phone number"
                    value={adminForm.phone}
                    onChange={handleAdminChange}
                    style={adminFieldErrors.phone ? { borderColor: '#ef4444' } : {}}
                  />
                  {adminFieldErrors.phone && (
                    <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                      {adminFieldErrors.phone}
                    </span>
                  )}
                </div>

                <div className="wizard-field-group">
                  <label className="wizard-field-label">Role</label>
                  <input
                    type="text"
                    className="wizard-field-input"
                    value="ADMIN"
                    disabled
                    readOnly
                    style={{ backgroundColor: '#f1f5f9', cursor: 'not-allowed', color: '#475569', fontWeight: 600 }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Prompt if no user type selected */}
          {!userType && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
              <p style={{ fontSize: '1rem', fontWeight: 500, margin: 0 }}>
                Please select a User Type above (Employee or Admin) to proceed.
              </p>
            </div>
          )}

          {/* ==================== STEP 1: Basic Information ==================== */}
          {userType === 'Employee' && currentStep === 1 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 1: Basic Information</h3>
              <p className="wizard-section-desc">
                Provide core organizational and identity credentials for the new employee.
              </p>

              <div className="wizard-form-grid">
                {/* Employee ID (Required) */}
                <div className="wizard-field-group wizard-field-full">
                  <label htmlFor="employeeId" className="wizard-field-label">
                    Employee ID <span className="required">*</span>
                  </label>
                  <input
                    id="employeeId"
                    name="employeeId"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.employeeId}
                    onChange={handleChange}
                    placeholder="Enter employee ID"
                  />
                  <span className="wizard-field-hint">
                    Format: GP followed by 4 digits and N (e.g., GP0025N).
                  </span>
                </div>

                {/* First Name (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="firstName" className="wizard-field-label">
                    First Name <span className="required">*</span>
                  </label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="Enter first name"
                  />
                </div>

                {/* Last Name (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="lastName" className="wizard-field-label">
                    Last Name <span className="required">*</span>
                  </label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Enter last name"
                  />
                </div>

                {/* Official Email (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="email" className="wizard-field-label">
                    Official Email <span className="required">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="Enter official email"
                  />
                </div>

                {/* Personal Email (Optional) */}
                <div className="wizard-field-group">
                  <label htmlFor="personalEmail" className="wizard-field-label">
                    Personal Email
                  </label>
                  <input
                    id="personalEmail"
                    name="personalEmail"
                    type="email"
                    className="wizard-field-input"
                    value={formData.personalEmail}
                    onChange={handleChange}
                    placeholder="Enter personal email"
                  />
                </div>

                {/* Phone Number (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="phone" className="wizard-field-label">
                    Phone Number <span className="required">*</span>
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="Enter 10-digit phone number"
                  />
                </div>

                {/* Profile Photo (Optional) */}
                <div className="wizard-field-group">
                  <label htmlFor="profilePhoto" className="wizard-field-label">
                    Profile Photo
                  </label>
                  <input
                    id="profilePhoto"
                    name="profilePhoto"
                    type="file"
                    accept="image/png, image/jpeg"
                    className="wizard-file-input"
                    onChange={(e) => handleFileChange(e, 'profilePhoto')}
                  />
                  {formData.profilePhoto && (
                    <div className="wizard-file-pill">
                      <span>{formData.profilePhoto.name}</span>
                      <button
                        type="button"
                        className="wizard-remove-file"
                        onClick={() => handleRemoveFile('profilePhoto')}
                      >
                        &times;
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 2: Personal & Contact ==================== */}
          {currentStep === 2 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 2: Personal & Contact Details</h3>
              <p className="wizard-section-desc">
                All personal and emergency contact fields are mandatory for statutory employee compliance.
              </p>

              <div className="wizard-form-grid">
                {/* Date of Birth (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="dateOfBirth" className="wizard-field-label">
                    Date of Birth <span className="required">*</span>
                  </label>
                  <input
                    id="dateOfBirth"
                    name="dateOfBirth"
                    type="date"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.dateOfBirth}
                    onChange={handleChange}
                  />
                </div>

                {/* Gender (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="gender" className="wizard-field-label">
                    Gender <span className="required">*</span>
                  </label>
                  <select
                    id="gender"
                    name="gender"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.gender}
                    onChange={handleChange}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Residential Address (Required) */}
                <div className="wizard-field-group wizard-field-full">
                  <label htmlFor="address" className="wizard-field-label">
                    Residential Address <span className="required">*</span>
                  </label>
                  <textarea
                    id="address"
                    name="address"
                    rows="2"
                    required
                    aria-required="true"
                    className="wizard-field-textarea"
                    value={formData.address}
                    onChange={handleChange}
                    placeholder="Enter residential address"
                  />
                </div>

                {/* City (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="city" className="wizard-field-label">
                    City <span className="required">*</span>
                  </label>
                  <input
                    id="city"
                    name="city"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.city}
                    onChange={handleChange}
                    placeholder="Enter city"
                  />
                </div>

                {/* State (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="state" className="wizard-field-label">
                    State <span className="required">*</span>
                  </label>
                  <input
                    id="state"
                    name="state"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.state}
                    onChange={handleChange}
                    placeholder="Enter state"
                  />
                </div>

                {/* Postal Code (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="postalCode" className="wizard-field-label">
                    Postal Code <span className="required">*</span>
                  </label>
                  <input
                    id="postalCode"
                    name="postalCode"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.postalCode}
                    onChange={handleChange}
                    placeholder="Enter postal code"
                  />
                </div>

                {/* Emergency Contact Name (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="emergencyContactName" className="wizard-field-label">
                    Emergency Contact Name <span className="required">*</span>
                  </label>
                  <input
                    id="emergencyContactName"
                    name="emergencyContactName"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.emergencyContactName}
                    onChange={handleChange}
                    placeholder="Enter emergency contact name"
                  />
                </div>

                {/* Emergency Contact Phone (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="emergencyContactPhone" className="wizard-field-label">
                    Emergency Contact Number <span className="required">*</span>
                  </label>
                  <input
                    id="emergencyContactPhone"
                    name="emergencyContactPhone"
                    type="tel"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.emergencyContactPhone}
                    onChange={handleChange}
                    placeholder="Enter emergency contact phone number"
                  />
                </div>

                {/* Emergency Contact Relationship (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="emergencyContactRelationship" className="wizard-field-label">
                    Emergency Contact Relationship <span className="required">*</span>
                  </label>
                  <input
                    id="emergencyContactRelationship"
                    name="emergencyContactRelationship"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.emergencyContactRelationship}
                    onChange={handleChange}
                    placeholder="Enter relationship (e.g. Spouse, Parent, Sibling)"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 3: Employment Details ==================== */}
          {currentStep === 3 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 3: Employment Details</h3>
              <p className="wizard-section-desc">
                Configure role, organizational department, reporting structure, and location.
              </p>

              <div className="wizard-form-grid">
                {/* Designation (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="designation" className="wizard-field-label">
                    Designation <span className="required">*</span>
                  </label>
                  <select
                    id="designation"
                    name="designation"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.designation}
                    onChange={handleChange}
                  >
                    <option value="">Select Designation</option>
                    {masterOptions.designations.map((desig) => (
                      <option key={desig} value={desig}>{desig}</option>
                    ))}
                    {formData.designation && !masterOptions.designations.includes(formData.designation) && (
                      <option value={formData.designation}>{formData.designation}</option>
                    )}
                  </select>
                </div>

                {/* Department (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="department" className="wizard-field-label">
                    Department <span className="required">*</span>
                  </label>
                  <select
                    id="department"
                    name="department"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.department}
                    onChange={handleChange}
                  >
                    {(masterOptions.departments || []).map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                {/* Date of Joining (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="dateOfJoining" className="wizard-field-label">
                    Date of Joining <span className="required">*</span>
                  </label>
                  <input
                    id="dateOfJoining"
                    name="dateOfJoining"
                    type="date"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.dateOfJoining}
                    onChange={handleChange}
                  />
                </div>

                {/* Employment Type (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="employmentType" className="wizard-field-label">
                    Employment Type <span className="required">*</span>
                  </label>
                  <select
                    id="employmentType"
                    name="employmentType"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.employmentType}
                    onChange={handleChange}
                  >
                    {masterOptions.employmentTypes.map((et) => (
                      <option key={et} value={et}>{et}</option>
                    ))}
                    {formData.employmentType && !masterOptions.employmentTypes.includes(formData.employmentType) && (
                      <option value={formData.employmentType}>{formData.employmentType}</option>
                    )}
                  </select>
                </div>

                {/* Reporting Manager (Optional) */}
                <div className="wizard-field-group">
                  <label htmlFor="reportingManager" className="wizard-field-label">
                    Reporting Manager
                  </label>
                  <input
                    id="reportingManager"
                    name="reportingManager"
                    type="text"
                    className="wizard-field-input"
                    value={formData.reportingManager}
                    onChange={handleChange}
                    placeholder="Enter reporting manager name"
                  />
                </div>

                {/* Work Location (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="workLocation" className="wizard-field-label">
                    Work Location <span className="required">*</span>
                  </label>
                  <select
                    id="workLocation"
                    name="workLocation"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.workLocation}
                    onChange={handleChange}
                  >
                    {masterOptions.locations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                    {formData.workLocation && !masterOptions.locations.includes(formData.workLocation) && (
                      <option value={formData.workLocation}>{formData.workLocation}</option>
                    )}
                  </select>
                </div>

                {/* Employee Status (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="status" className="wizard-field-label">
                    Employee Status <span className="required">*</span>
                  </label>
                  <select
                    id="status"
                    name="status"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.status}
                    onChange={handleChange}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>

                {/* Working Days per Week (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="workingDaysPerWeek" className="wizard-field-label">
                    Working Days per Week <span className="required">*</span>
                  </label>
                  <select
                    id="workingDaysPerWeek"
                    name="workingDaysPerWeek"
                    required
                    aria-required="true"
                    className="wizard-field-select"
                    value={formData.workingDaysPerWeek}
                    onChange={handleChange}
                  >
                    <option value="">Select working days per week</option>
                    <option value="5">5 Days</option>
                    <option value="6">6 Days</option>
                  </select>
                  <span className="wizard-field-hint">
                    Defines the employee's regular weekly working schedule.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 4: PF Details ==================== */}
          {currentStep === 4 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 4: PF Details</h3>
              <p className="wizard-section-desc">
                Provident fund and pension information. All PF fields are optional and can be submitted or deferred.
              </p>

              {/* PF Not Available Checkbox */}
              <div className="wizard-checkbox-banner">
                <label className="wizard-checkbox-label">
                  <input
                    type="checkbox"
                    name="pfNotAvailable"
                    checked={formData.pfNotAvailable}
                    onChange={handleChange}
                    className="wizard-checkbox-input"
                  />
                  <span>PF details not available now</span>
                </label>
                {formData.pfNotAvailable && (
                  <p className="wizard-checkbox-note">
                    PF record will not be created now. Provident fund details can be added subsequently.
                  </p>
                )}
              </div>

              {!formData.pfNotAvailable && (
                <div className="wizard-form-grid" style={{ marginTop: '1.25rem' }}>
                  {/* UAN Number */}
                  <div className="wizard-field-group">
                    <label htmlFor="uanNumber" className="wizard-field-label">
                      UAN Number
                    </label>
                    <input
                      id="uanNumber"
                      name="uanNumber"
                      type="text"
                      className="wizard-field-input"
                      value={formData.uanNumber}
                      onChange={handleChange}
                      placeholder="Enter 12-digit UAN number"
                    />
                    <span className="wizard-field-hint">12 numeric digits</span>
                  </div>

                  {/* PF Number */}
                  <div className="wizard-field-group">
                    <label htmlFor="pfNumber" className="wizard-field-label">
                      PF Number
                    </label>
                    <input
                      id="pfNumber"
                      name="pfNumber"
                      type="text"
                      className="wizard-field-input"
                      value={formData.pfNumber}
                      onChange={handleChange}
                      placeholder="Enter PF number"
                    />
                  </div>

                  {/* Pension Number */}
                  <div className="wizard-field-group">
                    <label htmlFor="pensionNumber" className="wizard-field-label">
                      Pension Number
                    </label>
                    <input
                      id="pensionNumber"
                      name="pensionNumber"
                      type="text"
                      className="wizard-field-input"
                      value={formData.pensionNumber}
                      onChange={handleChange}
                      placeholder="Enter pension number"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== STEP 5: Bank Details ==================== */}
          {currentStep === 5 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 5: Bank Details</h3>
              <p className="wizard-section-desc">
                Disbursement account details for monthly salary processing. IDFC Bank is configured by default.
              </p>

              {/* Bank Not Available Checkbox */}
              <div className="wizard-checkbox-banner">
                <label className="wizard-checkbox-label">
                  <input
                    type="checkbox"
                    name="bankNotAvailable"
                    checked={formData.bankNotAvailable}
                    onChange={handleChange}
                    className="wizard-checkbox-input"
                  />
                  <span>Bank details not available now</span>
                </label>
                {formData.bankNotAvailable && (
                  <p className="wizard-checkbox-note">
                    Bank record will not be created now. Banking information can be added subsequently.
                  </p>
                )}
              </div>

              {!formData.bankNotAvailable && (
                <div className="wizard-form-grid" style={{ marginTop: '1.25rem' }}>
                  {/* Account Holder Name (Required) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankAccountHolderName" className="wizard-field-label">
                      Account Holder Name <span className="required">*</span>
                    </label>
                    <input
                      id="bankAccountHolderName"
                      name="bankAccountHolderName"
                      type="text"
                      required
                      aria-required="true"
                      className="wizard-field-input"
                      value={formData.bankAccountHolderName}
                      onChange={handleChange}
                      placeholder="Enter account holder name"
                    />
                  </div>

                  {/* Bank Name (Dropdown, default IDFC Bank) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankName" className="wizard-field-label">
                      Bank Name <span className="required">*</span>
                    </label>
                    <select
                      id="bankName"
                      name="bankName"
                      required
                      aria-required="true"
                      className="wizard-field-select"
                      value={formData.bankName}
                      onChange={handleChange}
                    >
                      <option value="IDFC Bank">IDFC Bank</option>
                      <option value="State Bank of India">State Bank of India</option>
                      <option value="HDFC Bank">HDFC Bank</option>
                      <option value="ICICI Bank">ICICI Bank</option>
                      <option value="Axis Bank">Axis Bank</option>
                      <option value="Kotak Mahindra Bank">Kotak Mahindra Bank</option>
                      <option value="Punjab National Bank">Punjab National Bank</option>
                      <option value="Bank of Baroda">Bank of Baroda</option>
                    </select>
                  </div>

                  {/* Account Number (Required) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankAccountNumber" className="wizard-field-label">
                      Account Number <span className="required">*</span>
                    </label>
                    <input
                      id="bankAccountNumber"
                      name="bankAccountNumber"
                      type="password"
                      autoComplete="new-password"
                      required
                      aria-required="true"
                      className="wizard-field-input font-mono"
                      value={formData.bankAccountNumber}
                      onChange={handleChange}
                      placeholder="Enter 9 to 18 digit account number"
                    />
                    <span className="wizard-field-hint">9 to 18 numeric digits</span>
                  </div>

                  {/* Confirm Account Number (Required) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankConfirmAccountNumber" className="wizard-field-label">
                      Confirm Account Number <span className="required">*</span>
                    </label>
                    <input
                      id="bankConfirmAccountNumber"
                      name="bankConfirmAccountNumber"
                      type="text"
                      autoComplete="off"
                      required
                      aria-required="true"
                      className="wizard-field-input font-mono"
                      value={formData.bankConfirmAccountNumber}
                      onChange={handleChange}
                      placeholder="Re-enter account number to confirm"
                      style={isBankMismatch ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : {}}
                      aria-invalid={isBankMismatch}
                      aria-describedby={isBankMismatch ? 'bankConfirmMismatchError' : undefined}
                    />
                    {isBankMismatch && (
                      <span
                        id="bankConfirmMismatchError"
                        className="wizard-field-error"
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

                  {/* IFSC Code (Required) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankIfscCode" className="wizard-field-label">
                      IFSC Code <span className="required">*</span>
                    </label>
                    <input
                      id="bankIfscCode"
                      name="bankIfscCode"
                      type="text"
                      required
                      aria-required="true"
                      className="wizard-field-input font-mono"
                      value={formData.bankIfscCode}
                      onChange={(e) => {
                        setFormData((prev) => ({
                          ...prev,
                          bankIfscCode: e.target.value.toUpperCase(),
                        }));
                      }}
                      placeholder="e.g. IDFB0001234"
                      maxLength={11}
                    />
                    <span className="wizard-field-hint">11-character Indian financial code</span>
                  </div>

                  {/* Account Type (Dropdown) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankAccountType" className="wizard-field-label">
                      Account Type <span className="required">*</span>
                    </label>
                    <select
                      id="bankAccountType"
                      name="bankAccountType"
                      required
                      aria-required="true"
                      className="wizard-field-select"
                      value={formData.bankAccountType}
                      onChange={handleChange}
                    >
                      <option value="Savings">Savings</option>
                      <option value="Salary">Salary</option>
                      <option value="Current">Current</option>
                    </select>
                  </div>

                  {/* Branch Name (Optional) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankBranchName" className="wizard-field-label">
                      Branch Name
                    </label>
                    <input
                      id="bankBranchName"
                      name="bankBranchName"
                      type="text"
                      className="wizard-field-input"
                      value={formData.bankBranchName}
                      onChange={handleChange}
                      placeholder="e.g. Hitec City Branch"
                    />
                  </div>

                  {/* Branch City (Optional) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankBranchCity" className="wizard-field-label">
                      Branch City
                    </label>
                    <input
                      id="bankBranchCity"
                      name="bankBranchCity"
                      type="text"
                      className="wizard-field-input"
                      value={formData.bankBranchCity}
                      onChange={handleChange}
                      placeholder="e.g. Hyderabad"
                    />
                  </div>

                  {/* Branch State (Optional) */}
                  <div className="wizard-field-group">
                    <label htmlFor="bankBranchState" className="wizard-field-label">
                      Branch State
                    </label>
                    <input
                      id="bankBranchState"
                      name="bankBranchState"
                      type="text"
                      className="wizard-field-input"
                      value={formData.bankBranchState}
                      onChange={handleChange}
                      placeholder="e.g. Telangana"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== STEP 6: Salary & Payroll ==================== */}
          {currentStep === 6 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 6: Salary & Payroll Setup</h3>
              <p className="wizard-section-desc">
                Define the base monthly compensation profile for payroll calculations.
              </p>

              <div className="wizard-form-grid">
                {/* Basic Salary (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="basicSalary" className="wizard-field-label">
                    Basic Salary (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="basicSalary"
                    name="basicSalary"
                    type="number"
                    min="0"
                    step="500"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.basicSalary}
                    onChange={handleChange}
                    placeholder="Enter basic salary"
                  />
                </div>

                {/* HRA (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="hra" className="wizard-field-label">
                    HRA (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="hra"
                    name="hra"
                    type="number"
                    min="0"
                    step="500"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.hra}
                    onChange={handleChange}
                    placeholder="Enter HRA"
                  />
                </div>

                {/* Allowances (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="allowances" className="wizard-field-label">
                    Allowances (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="allowances"
                    name="allowances"
                    type="number"
                    min="0"
                    step="500"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.allowances}
                    onChange={handleChange}
                    placeholder="Enter allowances"
                  />
                </div>

                {/* PF Employee (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="pfEmployee" className="wizard-field-label">
                    Employee PF Deduction (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="pfEmployee"
                    name="pfEmployee"
                    type="number"
                    min="0"
                    step="100"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.pfEmployee}
                    onChange={handleChange}
                    placeholder="Enter employee PF deduction"
                  />
                </div>

                {/* Professional Tax (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="professionalTax" className="wizard-field-label">
                    Professional Tax (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="professionalTax"
                    name="professionalTax"
                    type="number"
                    min="0"
                    step="50"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.professionalTax}
                    onChange={handleChange}
                    placeholder="Enter professional tax"
                  />
                </div>

                {/* Other Deductions (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="otherDeductions" className="wizard-field-label">
                    Other Deductions (₹/month) <span className="required">*</span>
                  </label>
                  <input
                    id="otherDeductions"
                    name="otherDeductions"
                    type="number"
                    min="0"
                    step="100"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.otherDeductions}
                    onChange={handleChange}
                    placeholder="Enter other deductions"
                  />
                </div>
              </div>

              {/* Calculated Salary Box */}
              <div className="wizard-calc-summary-card">
                <div className="calc-summary-header">
                  <span className="calc-summary-title">Payroll Calculation Summary</span>
                  <span className="calc-badge">Calculated</span>
                </div>
                <div className="calc-summary-grid">
                  <div className="calc-item">
                    <span className="calc-item-label">Gross Salary</span>
                    <span className="calc-item-val">₹{salaryCalculations.gross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="calc-item">
                    <span className="calc-item-label">Total Deductions</span>
                    <span className="calc-item-val text-deduction">₹{salaryCalculations.deductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="calc-item calc-item-highlight">
                    <span className="calc-item-label">Estimated Net Salary</span>
                    <span className="calc-item-val text-net">₹{salaryCalculations.net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <small className="calc-note">
                  Estimated net salary is computed dynamically from entered earnings and deductions.
                </small>
              </div>
            </div>
          )}

          {/* ==================== STEP 7: Leave Setup ==================== */}
          {currentStep === 7 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 7: Leave Setup</h3>
              <p className="wizard-section-desc">
                Initialize statutory annual leave quotas for the employee.
              </p>

              <div className="wizard-form-grid">
                {/* Paid Leave (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="paidLeave" className="wizard-field-label">
                    Paid Leave (PL) <span className="required">*</span>
                  </label>
                  <input
                    id="paidLeave"
                    name="paidLeave"
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.paidLeave}
                    onChange={handleChange}
                    placeholder="Enter paid leave balance"
                  />
                  <span className="wizard-field-hint">Annual PL quota (e.g., 12 days)</span>
                </div>

                {/* Sick Leave (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="sickLeave" className="wizard-field-label">
                    Sick Leave <span className="required">*</span>
                  </label>
                  <input
                    id="sickLeave"
                    name="sickLeave"
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.sickLeave}
                    onChange={handleChange}
                    placeholder="Enter sick leave balance"
                  />
                  <span className="wizard-field-hint">Annual Sick leave quota (e.g., 10 days)</span>
                </div>

                {/* Unpaid Leave (Required) */}
                <div className="wizard-field-group">
                  <label htmlFor="unpaidLeave" className="wizard-field-label">
                    Unpaid Leave (UPL) <span className="required">*</span>
                  </label>
                  <input
                    id="unpaidLeave"
                    name="unpaidLeave"
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.unpaidLeave}
                    onChange={handleChange}
                    placeholder="Enter unpaid leave balance"
                  />
                  <span className="wizard-field-hint">Default 0</span>
                </div>
              </div>
            </div>
          )}

          {/* ==================== STEP 8: Documents ==================== */}
          {currentStep === 8 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 8: Documents</h3>
              <p className="wizard-section-desc">
                Upload initial onboarding documents. All documents are optional and can be submitted or uploaded later.
              </p>

              <div className="wizard-doc-grid">
                {[
                  { field: 'offerLetter', label: 'Offer Letter' },
                  { field: 'appointmentLetter', label: 'Appointment Letter' },
                  { field: 'aadhaarCard', label: 'Aadhaar Card' },
                  { field: 'panCard', label: 'PAN Card' },
                  { field: 'educationalCertificate', label: 'Educational Certificate' },
                  { field: 'pfDocument', label: 'PF Document' },
                  { field: 'otherDocument', label: 'Other Document' },
                ].map(({ field, label }) => {
                  const selectedFile = formData[field];
                  return (
                    <div key={field} className="wizard-doc-card">
                      <div className="doc-card-info">
                        <span className="doc-card-title">{label}</span>
                        <span className="doc-card-badge">Optional</span>
                      </div>

                      {selectedFile ? (
                        <div className="doc-file-selected">
                          <svg className="doc-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <div className="doc-file-meta">
                            <span className="doc-file-name">{selectedFile.name}</span>
                            <span className="doc-file-size">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                          </div>
                          <button
                            type="button"
                            className="doc-file-remove"
                            onClick={() => handleRemoveFile(field)}
                            title="Remove file"
                          >
                            &times;
                          </button>
                        </div>
                      ) : (
                        <div className="doc-upload-trigger">
                          <label htmlFor={`file-${field}`} className="doc-upload-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="doc-upload-svg">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            <span>Choose file</span>
                          </label>
                          <input
                            id={`file-${field}`}
                            type="file"
                            accept=".pdf, image/png, image/jpeg, image/jpg"
                            className="hidden-file-input"
                            onChange={(e) => handleFileChange(e, field)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <small className="wizard-field-hint" style={{ marginTop: '1rem', display: 'block' }}>
                Allowed formats: PDF, PNG, JPEG/JPG. Maximum file size: 10 MB per document.
              </small>
            </div>
          )}

          {/* ==================== STEP 9: Review & Final Create ==================== */}
          {currentStep === 9 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 9: Review & Final Create</h3>
              <p className="wizard-section-desc">
                Verify all employee records and financial configurations before atomic submission.
              </p>

              <div className="wizard-review-sections">
                {/* 1. Basic Information */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Basic Information</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(1)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Employee ID:</span> <span className="review-value font-mono">{formData.employeeId}</span></div>
                    <div><span className="review-label">Full Name:</span> <span className="review-value">{formData.firstName} {formData.lastName}</span></div>
                    <div><span className="review-label">Official Email:</span> <span className="review-value">{formData.email}</span></div>
                    <div><span className="review-label">Personal Email:</span> <span className="review-value">{formData.personalEmail || '—'}</span></div>
                    <div><span className="review-label">Phone Number:</span> <span className="review-value">{formData.phone}</span></div>
                    <div><span className="review-label">Profile Photo:</span> <span className="review-value">{formData.profilePhoto ? formData.profilePhoto.name : 'None'}</span></div>
                  </div>
                </div>

                {/* 2. Personal & Contact Details */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Personal & Contact Details</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(2)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Date of Birth:</span> <span className="review-value">{formData.dateOfBirth}</span></div>
                    <div><span className="review-label">Gender:</span> <span className="review-value">{formData.gender}</span></div>
                    <div><span className="review-label">Address:</span> <span className="review-value">{formData.address}</span></div>
                    <div><span className="review-label">City, State, Postal:</span> <span className="review-value">{formData.city}, {formData.state} - {formData.postalCode}</span></div>
                    <div><span className="review-label">Emergency Contact:</span> <span className="review-value">{formData.emergencyContactName} ({formData.emergencyContactRelationship})</span></div>
                    <div><span className="review-label">Emergency Phone:</span> <span className="review-value">{formData.emergencyContactPhone}</span></div>
                  </div>
                </div>

                {/* 3. Employment Details */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Employment Details</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(3)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Designation:</span> <span className="review-value">{formData.designation}</span></div>
                    <div><span className="review-label">Department:</span> <span className="review-value">{formData.department}</span></div>
                    <div><span className="review-label">Date of Joining:</span> <span className="review-value">{formData.dateOfJoining}</span></div>
                    <div><span className="review-label">Employment Type:</span> <span className="review-value">{formData.employmentType}</span></div>
                    <div><span className="review-label">Reporting Manager:</span> <span className="review-value">{formData.reportingManager || '—'}</span></div>
                    <div><span className="review-label">Work Location:</span> <span className="review-value">{formData.workLocation}</span></div>
                    <div><span className="review-label">Status:</span> <span className="review-value status-badge">{formData.status}</span></div>
                    <div><span className="review-label">Working Days:</span> <span className="review-value">{formData.workingDaysPerWeek ? `${formData.workingDaysPerWeek} Days / Week` : '5 Days / Week'}</span></div>
                  </div>
                </div>

                {/* 4. PF Details */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>PF Details</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(4)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    {formData.pfNotAvailable ? (
                      <div><span className="review-label">Status:</span> <span className="review-value text-muted">PF details deferred (Not available now)</span></div>
                    ) : (
                      <>
                        <div><span className="review-label">UAN Number:</span> <span className="review-value font-mono">{formData.uanNumber || '—'}</span></div>
                        <div><span className="review-label">PF Number:</span> <span className="review-value font-mono">{formData.pfNumber || '—'}</span></div>
                        <div><span className="review-label">Pension Number:</span> <span className="review-value font-mono">{formData.pensionNumber || '—'}</span></div>
                      </>
                    )}
                  </div>
                </div>

                {/* 5. Bank Details */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Bank Details</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(5)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    {formData.bankNotAvailable ? (
                      <div><span className="review-label">Status:</span> <span className="review-value text-muted">Bank details deferred (Not available now)</span></div>
                    ) : (
                      <>
                        <div><span className="review-label">Account Holder:</span> <span className="review-value">{formData.bankAccountHolderName || '—'}</span></div>
                        <div><span className="review-label">Bank Name:</span> <span className="review-value">{formData.bankName || 'IDFC Bank'}</span></div>
                        <div><span className="review-label">Account Number:</span> <span className="review-value font-mono">{formData.bankAccountNumber ? `••••••••${formData.bankAccountNumber.slice(-4)}` : '—'}</span></div>
                        <div><span className="review-label">IFSC Code:</span> <span className="review-value font-mono">{formData.bankIfscCode || '—'}</span></div>
                        <div><span className="review-label">Branch:</span> <span className="review-value">{[formData.bankBranchName, formData.bankBranchCity, formData.bankBranchState].filter(Boolean).join(', ') || '—'}</span></div>
                        <div><span className="review-label">Account Type:</span> <span className="review-value">{formData.bankAccountType}</span></div>
                      </>
                    )}
                  </div>
                </div>

                {/* 6. Salary & Payroll */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Salary & Payroll</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(6)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Basic Salary:</span> <span className="review-value">₹{parseFloat(formData.basicSalary || 0).toLocaleString('en-IN')}</span></div>
                    <div><span className="review-label">HRA:</span> <span className="review-value">₹{parseFloat(formData.hra || 0).toLocaleString('en-IN')}</span></div>
                    <div><span className="review-label">Allowances:</span> <span className="review-value">₹{parseFloat(formData.allowances || 0).toLocaleString('en-IN')}</span></div>
                    <div><span className="review-label">Gross Salary:</span> <span className="review-value font-bold">₹{salaryCalculations.gross.toLocaleString('en-IN')}</span></div>
                    <div><span className="review-label">Total Deductions:</span> <span className="review-value text-deduction">₹{salaryCalculations.deductions.toLocaleString('en-IN')}</span></div>
                    <div><span className="review-label">Estimated Net Salary:</span> <span className="review-value text-net font-bold">₹{salaryCalculations.net.toLocaleString('en-IN')}</span></div>
                  </div>
                </div>

                {/* 7. Leave Setup */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Leave Allocations</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(7)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Paid Leave (PL):</span> <span className="review-value">{formData.paidLeave} days</span></div>
                    <div><span className="review-label">Sick Leave:</span> <span className="review-value">{formData.sickLeave} days</span></div>
                    <div><span className="review-label">Unpaid Leave (UPL):</span> <span className="review-value">{formData.unpaidLeave} days</span></div>
                  </div>
                </div>

                {/* 8. Documents */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Attached Documents</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(8)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-docs">
                    {[
                      { field: 'offerLetter', label: 'Offer Letter' },
                      { field: 'appointmentLetter', label: 'Appointment Letter' },
                      { field: 'aadhaarCard', label: 'Aadhaar Card' },
                      { field: 'panCard', label: 'PAN Card' },
                      { field: 'educationalCertificate', label: 'Educational Certificate' },
                      { field: 'pfDocument', label: 'PF Document' },
                      { field: 'otherDocument', label: 'Other Document' },
                    ]
                      .filter(({ field }) => formData[field])
                      .map(({ field, label }) => (
                        <span key={field} className="review-doc-tag">
                          ✓ {label}: {formData[field].name}
                        </span>
                      ))}
                    {![
                      formData.offerLetter,
                      formData.appointmentLetter,
                      formData.aadhaarCard,
                      formData.panCard,
                      formData.educationalCertificate,
                      formData.pfDocument,
                      formData.otherDocument,
                    ].some(Boolean) && (
                      <span className="review-value text-muted">No documents attached (can be uploaded later)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="wizard-modal-footer">
          {userType === 'Admin' ? (
            <>
              <button
                type="button"
                className="wizard-btn wizard-btn-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wizard-btn wizard-btn-primary wizard-btn-submit"
                onClick={handleCreateAdmin}
                disabled={submitting}
              >
                {submitting ? 'Creating Administrator...' : 'Create Administrator'}
              </button>
            </>
          ) : userType === 'Employee' ? (
            <>
              <button
                type="button"
                className="wizard-btn wizard-btn-secondary"
                onClick={currentStep === 1 ? onClose : handleBack}
                disabled={submitting}
              >
                {currentStep === 1 ? 'Cancel' : 'Back'}
              </button>

              {currentStep < 9 ? (
                <button
                  type="button"
                  className="wizard-btn wizard-btn-primary"
                  onClick={handleNext}
                  disabled={submitting || (currentStep === 5 && isBankMismatch)}
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="button"
                  className="wizard-btn wizard-btn-primary wizard-btn-submit"
                  onClick={handleSubmit}
                  disabled={submitting || isBankMismatch}
                >
                  {submitting ? 'Creating Employee...' : 'Complete Onboarding'}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="wizard-btn wizard-btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmployeeOnboardingModal;
