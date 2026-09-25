import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import Button from '../Button';
import Banner from '../Banner';
import FormField from '../FormField';
import VoucherTermsFields, { defaultVoucherTerms, deriveHiddenTerms, expiryIso, type VoucherTermsValues } from './VoucherTermsFields';
import { createCampaign, type VoucherCampaign } from '../../services/voucher.service';
import { apiErrorMessage, extractServerFieldErrors } from '../../utils/serverValidation';

interface CampaignWizardProps {
  onClose: () => void;
  /** Fired on success — the caller typically opens the new campaign detail (CSV + print live there). */
  onCreated: (campaign: VoucherCampaign) => void;
}

/**
 * New-campaign wizard: campaign envelope (name, prefix, volume) plus the
 * shared offer-terms block. Success hands back the generated codes so the
 * caller can offer CSV download and slip printing immediately.
 */
export default function CampaignWizard({ onClose, onCreated }: CampaignWizardProps) {
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [codeCount, setCodeCount] = useState('100');
  const [terms, setTerms] = useState<VoucherTermsValues>(defaultVoucherTerms);
  // Same per-field surfacing as the standalone form: the API answers a bad
  // create with "Validation failed" plus the list of what was wrong.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ campaign: VoucherCampaign; codes: string[] } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const hidden = deriveHiddenTerms(terms);
      const result = await createCampaign({
        name: name.trim(),
        codePrefix: prefix.trim(),
        codeCount: Number(codeCount),
        title: terms.title,
        description: hidden.description,
        discountType: terms.discountType,
        ...(terms.discountType === 'fixed'
          ? { discountAmount: Number(terms.discountAmount) }
          : { discountPercent: Number(terms.discountPercent), ...(terms.maxDiscount ? { maxDiscount: Number(terms.maxDiscount) } : {}) }),
        ...(terms.minimumCharge ? { minimumCharge: Number(terms.minimumCharge) } : {}),
        startsAt: hidden.startsAt,
        expiresAt: expiryIso(terms.expiresAt),
      });
      setCreated(result);
      onCreated(result.campaign);
    } catch (err) {
      const detail = extractServerFieldErrors(err, {
        // Derived rather than asked for — point at the input that feeds them.
        description: 'title',
        startsAt: 'expiresAt',
      });
      setFieldErrors(detail?.fieldErrors ?? {});
      setError(detail?.summary ?? apiErrorMessage(err, 'Could not create the campaign.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content campaign-wizard-modal" role="dialog" aria-modal="true" aria-label="New voucher campaign" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{created ? `${created.campaign.name} ready` : 'New voucher campaign'}</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        {!created ? (
          <form onSubmit={submit}>
            <p className="modal-desc">
              One campaign, many unique single-claim codes — e.g. Dashain 20% off across 100 printed slips.
              Terms cannot be edited after creation; pause instead.
            </p>
            <fieldset disabled={saving} className="vouchers-fields">
              <FormField label="Campaign name" required minLength={3} error={fieldErrors.name} value={name} onChange={setName} placeholder="Dashain 2083" />
              <FormField
                label="Code prefix" required minLength={2} error={fieldErrors.codePrefix} value={prefix}
                onChange={v => setPrefix(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                placeholder="DASH" hint="Codes print as PREFIX-XXXXXX" maxLength={10}
              />
              <FormField label="How many codes" required type="number" min={1} max={5000} step={1} error={fieldErrors.codeCount} value={codeCount} onChange={setCodeCount} />
              <VoucherTermsFields values={terms} onChange={patch => setTerms({ ...terms, ...patch })} errors={fieldErrors} />
            </fieldset>
            {error && <Banner tone="danger">{error}</Banner>}
            <div className="modal-footer">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Generating…' : 'Generate codes'}</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="modal-desc">
              {created.codes.length} unique codes generated ({created.campaign.codePrefix}-XXXXXX).
              Press Done to open the campaign — CSV download and slip printing live there.
            </p>
            <p className="vouchers-codes-preview" aria-label="Sample of generated codes">
              {created.codes.slice(0, 8).join(' · ')}{created.codes.length > 8 ? ' · …' : ''}
            </p>
            <div className="modal-footer">
              <Button variant="secondary" onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
