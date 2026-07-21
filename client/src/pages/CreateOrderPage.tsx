import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import { getLocations, getVendors } from '../services/users.service';
import { getVendorQuote } from '../services/pricing.service';
import { createOrder, updateOrder, getSenderProfile, type CreateOrderInput, type UpdateOrderInput, type OrderType, type ServiceType } from '../services/orders.service';
import { isVendorSide } from '../utils/auth';
import './CreateOrderPage.css';

interface VendorOption {
  id: string;
  userId: string | null;
  label: string;
  phone: string;
  address: string;
  locationId: string | null;
}

interface LocationOption {
  id: string;
  name: string;
  code?: string | null;
  parentId?: string | null;
}

const SERVICE_TYPE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'home_delivery', label: 'Home Delivery' },
  { value: 'branch_delivery', label: 'Branch Delivery' },
];

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 'delivery', label: 'Delivery' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'return', label: 'Return' },
];

const PACKAGE_TYPE_OPTIONS = ['Parcel', 'Document', 'Fragile', 'Other'];
const OTHER_PACKAGE_TYPE = 'Other';

const DELIVERY_INSTRUCTION_OPTIONS = [
  'Cannot open the parcel',
  'Can open the parcel',
  'Call before delivery',
  'Handle with care',
  'Other',
];
const OTHER_DELIVERY_INSTRUCTION = 'Other';

const defaultFormState = {
  vendorId: '',
  serviceType: 'home_delivery' as ServiceType,
  orderType: 'delivery' as OrderType,
  originLocationId: '',
  destinationLocationId: '',
  customerName: '',
  contactNumber: '',
  alternateNumber: '',
  address: '',
  weightKg: '',
  codAmount: '',
  packageType: 'Parcel',
  packageTypeOther: '',
  deliveryInstruction: 'Cannot open the parcel',
  deliveryInstructionOther: '',
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

const CreateOrderPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as {
    initialData?: CreateOrderInput;
    mode?: 'copy' | 'edit';
    orderId?: string;
    trackingId?: string;
  } | null;
  const prefillInitialData = navState?.initialData;
  const editOrderId = navState?.mode === 'edit' ? navState.orderId : undefined;
  const editTrackingId = navState?.mode === 'edit' ? navState.trackingId : undefined;
  const isEditMode = Boolean(editOrderId);

  const isVendorActor = isVendorSide();
  // Orders keyed in by a plain admin always originate from that admin's own
  // hub — only a super_admin may pick a different origin (server enforces it).

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  // For a vendor/vendor_staff actor, this is their own vendor (fetched via
  // /orders/sender-profile, which resolves correctly for both roles - unlike
  // matching the vendors list by userId, which only ever matched the vendor
  // owner's account, never a staff member's).
  const [myVendorProfile, setMyVendorProfile] = useState<VendorOption | null>(null);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [generalError, setGeneralError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [quote, setQuote] = useState<{ weightSurcharge: number; baseCharge: number; totalPayable: number } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (isVendorActor) {
      // A vendor/vendor_staff actor IS the sender - resolve their own profile
      // directly instead of fetching every vendor in the system just to find
      // themselves in the list (which also never worked for vendor_staff,
      // since their user id isn't the vendor owner's user id).
      (async () => {
        try {
          const res = await getSenderProfile();
          if (res?.success) {
            setMyVendorProfile({
              id: res.data.id,
              userId: null,
              label: res.data.name,
              phone: res.data.phone,
              address: res.data.address,
              locationId: res.data.locationId,
            });
          }
        } catch (err) {
          console.error('Failed to load vendor profile:', err);
        }
      })();
    } else {
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
              locationId: v.locationId ?? null,
            })));
          }
        } catch (err) {
          console.error('Failed to load vendors:', err);
        }
      })();
    }
    (async () => {
      try {
        const res = await getLocations();
        if (res?.success && Array.isArray(res.data)) {
          setLocationOptions(res.data.map((l: any) => ({ id: l.id, name: l.name, code: l.code, parentId: l.parent_id })));
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    })();
  }, [isVendorActor]);

  // Prefill from a "copy"/"edit" navigation (replaces the old modal's initialData prop)
  useEffect(() => {
    if (!prefillInitialData) return;
    // A copied order's packageType/deliveryInstruction may be free text that
    // predates these presets - fall back to "Other" + the raw text so nothing
    // silently gets dropped.
    const incomingPackageType = prefillInitialData.packageType || 'Parcel';
    const isKnownPackageType = PACKAGE_TYPE_OPTIONS.includes(incomingPackageType);
    const incomingInstruction = prefillInitialData.deliveryInstruction || '';
    const isKnownInstruction = DELIVERY_INSTRUCTION_OPTIONS.includes(incomingInstruction);
    setForm(prev => ({
      ...prev,
      vendorId: prefillInitialData.vendorId || '',
      serviceType: prefillInitialData.serviceType || 'home_delivery',
      orderType: prefillInitialData.orderType || 'delivery',
      originLocationId: prefillInitialData.originLocationId || '',
      destinationLocationId: prefillInitialData.destinationLocationId || '',
      customerName: prefillInitialData.receiver?.name || '',
      contactNumber: prefillInitialData.receiver?.phone || '',
      alternateNumber: prefillInitialData.receiver?.alternatePhone || '',
      address: prefillInitialData.receiver?.address || '',
      weightKg: prefillInitialData.weightKg !== undefined ? String(prefillInitialData.weightKg) : '',
      codAmount: prefillInitialData.codAmount !== undefined ? String(prefillInitialData.codAmount) : '',
      packageType: isKnownPackageType ? incomingPackageType : OTHER_PACKAGE_TYPE,
      packageTypeOther: isKnownPackageType ? '' : incomingPackageType,
      deliveryInstruction: incomingInstruction
        ? (isKnownInstruction ? incomingInstruction : OTHER_DELIVERY_INSTRUCTION)
        : 'Cannot open the parcel',
      deliveryInstructionOther: incomingInstruction && !isKnownInstruction ? incomingInstruction : '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillInitialData]);

  // When actor is a vendor (or vendor_staff), their own sender identity is
  // implicit - no Vendor picker shown.
  const selectedVendor = isVendorActor ? myVendorProfile ?? undefined : vendors.find(v => v.id === form.vendorId);

  // The single admin hub all orders originate from. Matched by code first, name as fallback.
  const imadolHub = locationOptions.find(
    l => (l.code || '').toUpperCase() === 'IMADOL' || l.name.trim().toLowerCase() === 'imadol',
  );

  // Origin ("From") is always fixed to the Imadol admin hub — for vendors it's their
  // assigned hub (Imadol), for admins we lock it to Imadol too rather than a free picker.
  const fixedOriginId = isVendorActor ? selectedVendor?.locationId : imadolHub?.id;
  useEffect(() => {
    if (!fixedOriginId) return;
    setForm(prev => (prev.originLocationId === fixedOriginId ? prev : { ...prev, originLocationId: fixedOriginId }));
  }, [fixedOriginId]);

  const weightKgNumber = Number(form.weightKg) || 0;

  // Auto-calculate the payable amount from the VENDOR's chosen rate model
  // (per-destination / zone / flat) — mirrors the server-side charge in
  // order.service.ts so the displayed number matches what gets saved.
  useEffect(() => {
    const vendorId = selectedVendor?.id;
    // Need a destination, a weight, and a resolvable vendor (admins must pick one).
    if (!form.destinationLocationId || !weightKgNumber || (!isVendorActor && !form.vendorId)) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError('');
    const timer = setTimeout(async () => {
      try {
        const res = await getVendorQuote(form.destinationLocationId, weightKgNumber, vendorId);
        if (!cancelled && res?.success) {
          setQuote(res.data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(
            err.response?.status === 404
              ? (err.response?.data?.message || 'No rate configured for this destination yet. Contact an admin.')
              : 'Failed to calculate charges for this destination.',
          );
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.destinationLocationId, weightKgNumber, form.vendorId, selectedVendor?.id, isVendorActor]);

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
    if (successMessage) setSuccessMessage('');
  };

  const resetForm = () => {
    // For a vendor actor, origin is always their own hub and the field is
    // disabled - the effect that fills it from myVendorProfile only re-runs
    // when selectedVendor?.locationId changes, which it doesn't on reset, so
    // it must be restored here or the form is stuck with a required-but-unfixable field.
    setForm({
      ...defaultFormState,
      originLocationId: fixedOriginId ?? '',
    });
    setQuote(null);
    setQuoteError('');
    setFieldErrors({});
    setGeneralError('');
    setSuccessMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');

    // Validate all fields up-front so every error is shown at once
    const errors: Partial<Record<keyof FormState, string>> = {};

    // Edit mode: the vendor is fixed (and may legitimately be empty for
    // admin-created orders), so don't demand one.
    if (!isVendorActor && !form.vendorId && !isEditMode) {
      errors.vendorId = 'Please select a vendor.';
    }
    // Edit mode: older/imported parcels may predate route locations — leaving
    // them unset means "unchanged", so only creation demands them.
    if (!form.originLocationId && !isEditMode) {
      errors.originLocationId = 'Please select an origin location.';
    }
    if (!form.destinationLocationId && !isEditMode) {
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
    if (form.packageType === OTHER_PACKAGE_TYPE && !form.packageTypeOther.trim()) {
      errors.packageTypeOther = 'Please specify the package type.';
    }
    if (form.deliveryInstruction === OTHER_DELIVERY_INSTRUCTION && !form.deliveryInstructionOther.trim()) {
      errors.deliveryInstructionOther = 'Please specify the delivery instruction.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Editing must never be blocked by a missing rate config — the server only
    // re-prices when weight/route actually changed, and keeps the old charge
    // when no rate resolves.
    if (!quote && !isEditMode) {
      setGeneralError('Charges could not be calculated for this route. Please configure a delivery rate first.');
      return;
    }

    const sender = selectedVendor
      ? { name: selectedVendor.label, phone: selectedVendor.phone, address: selectedVendor.address }
      : { name: form.customerName, phone: form.contactNumber, address: form.address };

    const effectivePackageType = form.packageType === OTHER_PACKAGE_TYPE
      ? form.packageTypeOther.trim()
      : form.packageType;
    const effectiveDeliveryInstruction = form.deliveryInstruction === OTHER_DELIVERY_INSTRUCTION
      ? form.deliveryInstructionOther.trim()
      : form.deliveryInstruction;

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
      packageType: effectivePackageType || undefined,
      deliveryInstruction: effectiveDeliveryInstruction || undefined,
      pickupAddress: selectedVendor?.address || undefined,
    };

    setSubmitting(true);
    try {
      if (isEditMode && editOrderId) {
        const editPayload: UpdateOrderInput = {
          receiver: payload.receiver,
          // Empty means "leave the route as it is", not "clear it".
          originLocationId: payload.originLocationId || undefined,
          destinationLocationId: payload.destinationLocationId || undefined,
          orderType: payload.orderType,
          serviceType: payload.serviceType,
          weightKg: payload.weightKg,
          codAmount: payload.codAmount,
          packageType: payload.packageType,
          deliveryInstruction: payload.deliveryInstruction,
        };
        const res = await updateOrder(editOrderId, editPayload);
        navigate('/orders', { state: { notice: `Order ${res.data.trackingId} updated.` } });
        return;
      }
      const res = await createOrder(payload);
      resetForm();
      setSuccessMessage(`Order #${res.data.orderNumber} (${res.data.trackingId}) created successfully. You can create another order below.`);
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

  // Destinations are top-level locations; covered areas (children with a
  // parentId) are delivery zones within them, not valid order destinations.
  const destinationSelectOptions = locationOptions
    .filter(l => !l.parentId)
    .map(l => ({ id: l.id, label: l.name }));

  // Lookup Branch: same destinations, but each carries its covered areas as the
  // option description - the search then also matches area names (SearchableSelect
  // filters and highlights descriptions), so typing "Gwarko" finds Imadol.
  const lookupBranchOptions = locationOptions
    .filter(l => !l.parentId)
    .map(l => {
      const areas = locationOptions.filter(a => a.parentId === l.id).map(a => a.name);
      return {
        id: l.id,
        label: l.name,
        description: areas.length > 0 ? `Covers: ${areas.join(', ')}` : undefined,
      };
    });

  // Vendors never pick their own origin - it's always their hub (e.g. Imadol),
  // so "From" is shown read-only instead of an editable dropdown.
  const originHubName = locationOptions.find(l => l.id === fixedOriginId)?.name;

  return (
    <div className="create-order-page">
      <PageHeader
        title={isEditMode ? 'Edit Order' : 'Create Order'}
        subtitle={isEditMode
          ? `Update parcel details for ${editTrackingId || 'this order'}. Changes are recorded in the parcel history.`
          : 'Set up and submit new package orders through the system.'}
      />

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
                disabled={isEditMode}
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
                value={originHubName || 'No hub assigned - contact an admin'}
                onChange={() => {}}
                disabled
                error={fieldErrors.originLocationId}
              />
              <FormField
                label="To"
                required
                type="searchable-select"
                searchableOptions={destinationSelectOptions}
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
                placeholder="Enter location on Google Maps"
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
                options={PACKAGE_TYPE_OPTIONS.map(opt => ({ value: opt, label: opt }))}
                value={form.packageType}
                onChange={value => setField('packageType', value)}
                error={fieldErrors.packageType}
              />
              {form.packageType === OTHER_PACKAGE_TYPE && (
                <FormField
                  label="Specify Package Type"
                  required
                  value={form.packageTypeOther}
                  onChange={value => setField('packageTypeOther', value)}
                  placeholder="Enter package type"
                  error={fieldErrors.packageTypeOther}
                  gridColumn="span 2"
                />
              )}
              <FormField
                label="Delivery Instruction"
                type="select"
                placeholder="Select delivery instruction"
                options={DELIVERY_INSTRUCTION_OPTIONS.map(opt => ({ value: opt, label: opt }))}
                value={form.deliveryInstruction}
                onChange={value => setField('deliveryInstruction', value)}
                error={fieldErrors.deliveryInstruction}
              />
              {form.deliveryInstruction === OTHER_DELIVERY_INSTRUCTION && (
                <FormField
                  label="Specify Delivery Instruction"
                  required
                  value={form.deliveryInstructionOther}
                  onChange={value => setField('deliveryInstructionOther', value)}
                  placeholder="Enter delivery instruction"
                  error={fieldErrors.deliveryInstructionOther}
                  gridColumn="span 2"
                />
              )}
            </div>
          </div>
        </div>

        <div className="create-order-side">
          <div className="order-card">
            <h2>Lookup Branch</h2>
            <FormField
              label=""
              type="searchable-select"
              searchableOptions={lookupBranchOptions}
              value={form.destinationLocationId}
              onChange={id => setField('destinationLocationId', id)}
              placeholder="Search branch"
              searchPlaceholder="Search branch or covered area..."
              emptyMessage="No branches found."
            />
          </div>

          <div className="order-card order-summary-card">
            <h2>Order Summary</h2>
            <div className="order-summary-row">
              <span>Weight</span>
              <span>{weightKgNumber ? `${weightKgNumber.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg` : '-'}</span>
            </div>
            <div className="order-summary-row">
              <span>Base Charge</span>
              <span>{quote ? quote.baseCharge.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</span>
            </div>
            {quote !== null && quote.weightSurcharge > 0 && (
              <div className="order-summary-row">
                <span>Weight Surcharge</span>
                <span>{quote.weightSurcharge.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            )}
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

          {successMessage && <p className="order-form-success">{successMessage}</p>}
          {generalError && <p className="order-form-error">{generalError}</p>}

          <div className="create-order-actions">
            <Button type="submit" variant="primary" grow disabled={submitting}>
              {isEditMode
                ? (submitting ? 'Saving...' : 'Save Changes')
                : (submitting ? 'Creating...' : 'Create Order')}
            </Button>
            {isEditMode ? (
              <Button type="button" variant="secondary" onClick={() => navigate('/orders')} disabled={submitting}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={resetForm} disabled={submitting}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};

export default CreateOrderPage;
