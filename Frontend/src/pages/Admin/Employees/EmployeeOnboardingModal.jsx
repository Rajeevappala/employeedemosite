import { useState, useMemo } from 'react';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
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
  department: 'Technology',
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

  // Step 5: Salary & Payroll
  basicSalary: '40000',
  hra: '16000',
  allowances: '8000',
  pfEmployee: '1800',
  professionalTax: '200',
  otherDeductions: '0',

  // Step 6: Leave Setup
  paidLeave: '12',
  sickLeave: '10',
  unpaidLeave: '0',

  // Step 7: Documents
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
  { number: 5, label: 'Salary' },
  { number: 6, label: 'Leaves' },
  { number: 7, label: 'Documents' },
  { number: 8, label: 'Review' },
];

function EmployeeOnboardingModal({ isOpen, onClose, onSuccess }) {
  const { user: currentUser } = useAuth();
  const [userType, setUserType] = useState('Employee');
  const [adminForm, setAdminForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(INITIAL_WIZARD_DATA);
  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAdminChange = (e) => {
    const { name, value } = e.target;
    setStepError('');
    setAdminForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCreateAdmin = async (e) => {
    if (e) e.preventDefault();
    setStepError('');

    if (!adminForm.firstName.trim()) {
      setStepError('First name is required.');
      return;
    }
    if (!adminForm.lastName.trim()) {
      setStepError('Last name is required.');
      return;
    }
    if (!adminForm.email.trim()) {
      setStepError('Email address is required.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminForm.email.trim().toLowerCase())) {
      setStepError('Invalid email address format.');
      return;
    }
    if (adminForm.phone && adminForm.phone.trim()) {
      if (!/^[0-9+()\- ]{7,20}$/.test(adminForm.phone.trim())) {
        setStepError('Invalid phone number format.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await api.admin.createUser({
        role: 'ADMIN',
        userType: 'Admin',
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
      setStepError(err.message || 'An error occurred while creating administrator.');
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

    if (stepNumber === 6) {
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
      setCurrentStep((prev) => Math.min(prev + 1, 8));
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
    // Final verification across all steps
    for (let s = 1; s <= 6; s++) {
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

      // Step 5
      payload.append('basic_salary', formData.basicSalary);
      payload.append('hra', formData.hra);
      payload.append('allowances', formData.allowances);
      payload.append('pf_employee', formData.pfEmployee);
      payload.append('professional_tax', formData.professionalTax);
      payload.append('other_deductions', formData.otherDeductions);

      // Step 6
      payload.append('paid_leave', formData.paidLeave);
      payload.append('sick_leave', formData.sickLeave);
      payload.append('unpaid_leave', formData.unpaidLeave);

      // Step 7
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
            {currentUser?.role === 'SUPER_ADMIN' && <option value="Admin">Admin</option>}
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
                  />
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
                  />
                </div>

                <div className="wizard-field-group wizard-field-full">
                  <label htmlFor="adminEmail" className="wizard-field-label">
                    Email <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    id="adminEmail"
                    name="email"
                    className="wizard-field-input"
                    placeholder="Enter email"
                    value={adminForm.email}
                    onChange={handleAdminChange}
                  />
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
                  />
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
                  <input
                    id="designation"
                    name="designation"
                    type="text"
                    required
                    aria-required="true"
                    className="wizard-field-input"
                    value={formData.designation}
                    onChange={handleChange}
                    placeholder="Enter designation"
                  />
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
                    <option value="Technology">Technology</option>
                    <option value="HR">HR</option>
                    <option value="Finance">Finance</option>
                    <option value="Operations">Operations</option>
                    <option value="Sales">Sales</option>
                    <option value="Marketing">Marketing</option>
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
                    <option value="Full Time">Full Time</option>
                    <option value="Part Time">Part Time</option>
                    <option value="Contract">Contract</option>
                    <option value="Intern">Intern</option>
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
                    <option value="Hyderabad">Hyderabad</option>
                    <option value="Bangalore">Bangalore</option>
                    <option value="Mumbai">Mumbai</option>
                    <option value="Pune">Pune</option>
                    <option value="Remote">Remote</option>
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

          {/* ==================== STEP 5: Salary & Payroll ==================== */}
          {currentStep === 5 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 5: Salary & Payroll Setup</h3>
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

          {/* ==================== STEP 6: Leave Setup ==================== */}
          {currentStep === 6 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 6: Leave Setup</h3>
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

          {/* ==================== STEP 7: Documents ==================== */}
          {currentStep === 7 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 7: Documents</h3>
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

          {/* ==================== STEP 8: Review & Final Create ==================== */}
          {currentStep === 8 && (
            <div className="wizard-step-content">
              <h3 className="wizard-section-heading">Step 8: Review & Final Create</h3>
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

                {/* 5. Salary & Payroll */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Salary & Payroll</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(5)}>
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

                {/* 6. Leave Setup */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Leave Allocations</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(6)}>
                      Edit
                    </button>
                  </div>
                  <div className="review-card-grid">
                    <div><span className="review-label">Paid Leave (PL):</span> <span className="review-value">{formData.paidLeave} days</span></div>
                    <div><span className="review-label">Sick Leave:</span> <span className="review-value">{formData.sickLeave} days</span></div>
                    <div><span className="review-label">Unpaid Leave (UPL):</span> <span className="review-value">{formData.unpaidLeave} days</span></div>
                  </div>
                </div>

                {/* 7. Documents */}
                <div className="review-section-card">
                  <div className="review-card-header">
                    <h4>Attached Documents</h4>
                    <button type="button" className="review-edit-btn" onClick={() => handleJumpToStep(7)}>
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

              {currentStep < 8 ? (
                <button
                  type="button"
                  className="wizard-btn wizard-btn-primary"
                  onClick={handleNext}
                  disabled={submitting}
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="button"
                  className="wizard-btn wizard-btn-primary wizard-btn-submit"
                  onClick={handleSubmit}
                  disabled={submitting}
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
