import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import { getLocations, getVendors } from '../services/users.service';
import { getDeliveryQuote } from '../services/deliveryRates.service';
import { createOrder, type CreateOrderInput, type OrderType, type ServiceType } from '../services/orders.service';
import './CreateOrderPage.css';

interface VendorOption {
  id: string;
  userId: string | null;
  label: string;
  phone: string;
  address: string;
}

interface LocationOption {
  id: string;
  name: string;
}

const SERVICE_TYPE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'dtd', label: 'Door to Door (DTD)' },
  { value: 'btd', label: 'Branch to Door (BTD)' },
  { value: 'btb', label: 'Branch to Branch (BTB)' },
  { value: 'dtb', label: 'Door to Branch (DTB)' },
];

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'return', label: 'Return' },
];

const PACKAGE_TYPE_OPTIONS = ['Document', 'Parcel', 'Fragile', 'Other'];

const defaultFormState = {
  vendorId: '',
  serviceType: 'dtd' as ServiceType,
  orderType: 'delivery' as OrderType,
  originLocationId: '',
  destinationLocationId: '',
  customerName: '',
  contactNumber: '',
  alternateNumber: '',
  address: '',
  weightKg: '',
  codAmount: '',
  packageType: '',
  deliveryInstruction: '',
};

type FormState = typeof defaultFormState;

// Maps server-side Zod field paths → form state keys
const SERVER_FIELD_MAP: Record<string, keyof FormState> = {
  vendorId: 'vendorId',
  originLocationId: 'originLocationId',
  destinationLocationId: 'destinationLocationId',
  serviceType: 'serviceType',
  orderType: 'orderType',
  'receiver.name': 'customerName',
  'receiver.phone': 'contactNumber',
  'receiver.alternatePhone': 'alternateNumber',
  'receiver.address': 'address',
  'receiver.locationId': 'destinationLocationId',
  weightKg: 'weightKg',
  codAmount: 'codAmount',
  packageType: 'packageType',
  deliveryInstruction: 'deliveryInstruction',
};

const getCurrentUser = (): { id: string; roles: string[] } | null => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

const CreateOrderPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillInitialData = (location.state as { initialData?: CreateOrderInput } | null)?.initialData;

  const currentUser = getCurrentUser();
  const isVendorActor = Boolean(currentUser?.roles?.includes('vendor'));

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [generalError, setGeneralError] = useState('');

  const [quote, setQuote] = useState<{ weightSurcharge: number; baseCharge: number; totalPayable: number } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await getVendors();
        if (res?.success && Array.isArray(res.data)) {
          setVendors(res.data.map((v: any) => ({
            id: v.id,
            userId: v.userId,
            label: v.company || v.client,
            phone: v.phone,
            address: v.address || '',
          })));
        }
      } catch (err) {
        console.error('Failed to load vendors:', err);
      }
    })();
    (async () => {
      try {
        const res = await getLocations();
        if (res?.success && Array.isArray(res.data)) {
          setLocationOptions(res.data.map((l: any) => ({ id: l.id, name: l.name })));
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!prefillInitialData) return;
    setForm(prev => ({
      ...prev,
      vendorId: prefillInitialData.vendorId || '',
      serviceType: prefillInitialData.serviceType || 'dtd',
      orderType: prefillInitialData.orderType || 'delivery',
      originLocationId: prefillInitialData.originLocationId || '',
      destinationLocationId: prefillInitialData.destinationLocationId || '',
      customerName: prefillInitialData.receiver?.name || '',
      contactNumber: prefillInitialData.receiver?.phone || '',
      alternateNumber: prefillInitialData.receiver?.alternatePhone || '',
      address: prefillInitialData.receiver?.address || '',
      weightKg: prefillInitialData.weightKg !== undefined ? String(prefillInitialData.weightKg) : '',
      codAmount: prefillInitialData.codAmount !== undefined ? String(prefillInitialData.codAmount) : '',
      packageType: prefillInitialData.packageType || '',
      deliveryInstruction: prefillInitialData.deliveryInstruction || '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillInitialData]);

  const myVendor = useMemo(
    () => (isVendorActor ? vendors.find(v => v.userId === currentUser?.id) : undefined),
    [isVendorActor, vendors, currentUser?.id],
  );

  const selectedVendor = isVendorActor ? myVendor : vendors.find(v => v.id === form.vendorId);

  const weightKgNumber = Number(form.weightKg) || 0;

  useEffect(() => {
    if (!form.originLocationId || !form.destinationLocationId || !weightKgNumber) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError('');
    const timer = setTimeout(async () => {
      try {
        const res = await getDeliveryQuote(form.originLocationId, form.destinationLocationId, weightKgNumber);
        if (!cancelled && res?.success) {
          setQuote(res.data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(
            err.response?.status === 404
              ? 'No delivery rate configured for this route yet. Contact an admin to set one up.'
              : 'Failed to calculate charges for this route.',
          );
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.originLocationId, form.destinationLocationId, weightKgNumber]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    // Clear the inline error for this field as soon as the user edits it
    setFieldErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (generalError) setGeneralError('');
  };

  const resetForm = () => {
    setForm(defaultFormState);
    setQuote(null);
    setQuoteError('');
    setFieldErrors({});
    setGeneralError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');

    // Validate all fields up-front so every error is shown at once
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (!isVendorActor && !form.vendorId) {
      errors.vendorId = 'Please select a vendor.';
    }
    if (!form.originLocationId) {
      errors.originLocationId = 'Please select an origin location.';
    }
    if (!form.destinationLocationId) {
      errors.destinationLocationId = 'Please select a destination location.';
    }
    if (!form.customerName.trim()) {
      errors.customerName = 'Customer name is required.';
    } else if (!/[a-zA-Z]/.test(form.customerName)) {
      errors.customerName = 'Customer name must contain letters.';
    }
    if (!form.contactNumber.trim()) {
      errors.contactNumber = 'Contact number is required.';
    }
    if (!form.address.trim()) {
      errors.address = 'Delivery address is required.';
    }
    if (!weightKgNumber) {
      errors.weightKg = 'Package weight is required.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!quote) {
      setGeneralError('Charges could not be calculated for this route. Please configure a delivery rate first.');
      return;
    }

    const sender = selectedVendor
      ? { name: selectedVendor.label, phone: selectedVendor.phone, address: selectedVendor.address }
      : { name: form.customerName, phone: form.contactNumber, address: form.address };

    const payload: CreateOrderInput = {
      vendorId: isVendorActor ? undefined : form.vendorId,
      sender,
      receiver: {
        name: form.customerName.trim(),
        phone: form.contactNumber.trim(),
        alternatePhone: form.alternateNumber.trim() || undefined,
        address: form.address.trim(),
        locationId: form.destinationLocationId,
      },
      originLocationId: form.originLocationId,
      destinationLocationId: form.destinationLocationId,
      orderType: form.orderType,
      serviceType: form.serviceType,
      pieces: 1,
      weightKg: weightKgNumber,
      codAmount: Number(form.codAmount) || 0,
      packageType: form.packageType || undefined,
      deliveryInstruction: form.deliveryInstruction.trim() || undefined,
      pickupAddress: selectedVendor?.address || undefined,
    };

    setSubmitting(true);
    try {
      await createOrder(payload);
      navigate('/orders');
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.errors?.length) {
        const mapped: Partial<Record<keyof FormState, string>> = {};
        const unmapped: string[] = [];
        for (const e of data.errors as { field: string; message: string }[]) {
          const key = SERVER_FIELD_MAP[e.field];
          if (key) {
            mapped[key] = e.message;
          } else {
            unmapped.push(e.message);
          }
        }
        setFieldErrors(mapped);
        if (unmapped.length > 0) setGeneralError(unmapped[0]);
      } else {
        setGeneralError(data?.message || 'Failed to create order. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const locationSelectOptions = locationOptions.map(l => ({ id: l.id, label: l.name }));

  return (
    <div className="create-order-page">
      <PageHeader title="Create Order" subtitle="Set up and submit new package orders through the system." />

      <form className="create-order-body" onSubmit={handleSubmit}>
        <div className="create-order-main">
          {!isVendorActor && (
            <div className="order-card">
              <h2>Vendor</h2>
              <FormField
                label="Vendor Name"
                required
                type="searchable-select"
                searchableOptions={vendors.map(v => ({ id: v.id, label: v.label }))}
                value={form.vendorId}
                onChange={id => setField('vendorId', id)}
                placeholder="Select vendor"
                searchPlaceholder="Search vendor by name..."
                emptyMessage="No vendors found."
                error={fieldErrors.vendorId}
              />
            </div>
          )}

          <div className="order-card">
            <h2>Order information</h2>
            <div className="order-field-row">
              <FormField
                label="Service Type"
                required
                type="select"
                options={SERVICE_TYPE_OPTIONS}
                value={form.serviceType}
                onChange={value => setField('serviceType', value as ServiceType)}
                error={fieldErrors.serviceType}
              />
              <FormField
                label="Order type"
                required
                type="select"
                options={ORDER_TYPE_OPTIONS}
                value={form.orderType}
                onChange={value => setField('orderType', value as OrderType)}
                error={fieldErrors.orderType}
              />
            </div>
          </div>

          <div className="order-card">
            <h2>Route Details</h2>
            <div className="order-field-row">
              <FormField
                label="From"
                required
                type="searchable-select"
                searchableOptions={locationSelectOptions}
                value={form.originLocationId}
                onChange={id => setField('originLocationId', id)}
                placeholder="Enter Origin"
                searchPlaceholder="Search origin..."
                emptyMessage="No locations found."
                error={fieldErrors.originLocationId}
              />
              <FormField
                label="To"
                required
                type="searchable-select"
                searchableOptions={locationSelectOptions}
                value={form.destinationLocationId}
                onChange={id => setField('destinationLocationId', id)}
                placeholder="Enter Destination"
                searchPlaceholder="Search destination..."
                emptyMessage="No locations found."
                error={fieldErrors.destinationLocationId}
              />
            </div>
          </div>

          <div className="order-card">
            <h2>Customer Details</h2>
            <div className="order-field-grid">
              <FormField
                label="Customer Name"
                required
                value={form.customerName}
                onChange={value => setField('customerName', value)}
                placeholder="Enter customer name"
                error={fieldErrors.customerName}
              />
              <FormField
                label="Contact Number"
                required
                value={form.contactNumber}
                onChange={value => setField('contactNumber', value)}
                placeholder="Enter contact number"
                error={fieldErrors.contactNumber}
              />
              <FormField
                label="Alternate Number"
                value={form.alternateNumber}
                onChange={value => setField('alternateNumber', value)}
                placeholder="Enter alternate number"
                error={fieldErrors.alternateNumber}
              />
              <FormField
                label="Address"
                required
                value={form.address}
                onChange={value => setField('address', value)}
                placeholder="Enter address"
                error={fieldErrors.address}
              />
            </div>
          </div>

          <div className="order-card">
            <h2>Package Details</h2>
            <div className="order-field-grid">
              <FormField
                label="Weight (kg)"
                required
                type="number"
                min={0}
                step="0.1"
                value={form.weightKg}
                onChange={value => setField('weightKg', value)}
                placeholder="Enter weight (kg)"
                error={fieldErrors.weightKg}
              />
              <FormField
                label="COD Amount"
                required
                type="number"
                min={0}
                value={form.codAmount}
                onChange={value => setField('codAmount', value)}
                placeholder="Enter COD amount"
                error={fieldErrors.codAmount}
              />
              <FormField
                label="Package Type"
                type="select"
                placeholder="Select package type"
                options={PACKAGE_TYPE_OPTIONS.map(opt => ({ value: opt, label: opt }))}
                value={form.packageType}
                onChange={value => setField('packageType', value)}
                error={fieldErrors.packageType}
              />
              <FormField
                label="Delivery Instruction"
                value={form.deliveryInstruction}
                onChange={value => setField('deliveryInstruction', value)}
                placeholder="Enter Delivery Instruction"
                error={fieldErrors.deliveryInstruction}
              />
            </div>
          </div>
        </div>

        <div className="create-order-side">
          <div className="order-card">
            <h2>Lookup Branch</h2>
            <FormField
              label=""
              type="searchable-select"
              searchableOptions={locationSelectOptions}
              value={form.destinationLocationId}
              onChange={id => setField('destinationLocationId', id)}
              placeholder="Search branch"
              searchPlaceholder="Search branch..."
              emptyMessage="No branches found."
            />
          </div>

          <div className="order-card order-summary-card">
            <h2>Order Summary</h2>
            <div className="order-summary-row">
              <span>Weight</span>
              <span>{quote ? quote.weightSurcharge.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
            </div>
            <div className="order-summary-row">
              <span>Delivery Charge</span>
              <span>{quote ? quote.baseCharge.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
            </div>
            <div className="order-summary-divider" />
            <div className="order-summary-row order-summary-total">
              <span>Total Payable</span>
              <span>{quote ? quote.totalPayable.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
            </div>
            <div className="order-summary-info">
              <Info size={16} />
              <span>
                {quoteLoading
                  ? 'Calculating charges...'
                  : quoteError || 'Charges will be calculated automatically based on the details provided.'}
              </span>
            </div>
          </div>

          {generalError && <p className="order-form-error">{generalError}</p>}

          <div className="create-order-actions">
            <Button type="submit" variant="primary" grow disabled={submitting}>
              {submitting ? 'Creating...' : 'New Order'}
            </Button>
            <Button type="button" variant="secondary" onClick={resetForm} disabled={submitting}>
              Reset
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CreateOrderPage;
