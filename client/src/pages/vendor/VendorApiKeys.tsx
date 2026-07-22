import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, Plus, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Button from '../../components/Button';
import {
  createApiKey,
  getApiKeys,
  revokeApiKey,
  type ApiKey,
} from '../../services/apiKeys.service';
import { toBsDateTime } from '../../utils/nepaliDate';
import '../../components/Modal.css';
import './VendorApiKeys.css';

const formatDate = (value: string | null) => (value ? toBsDateTime(value) : '—');

const VendorApiKeys: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // Plaintext key from the last create — shown once, cleared when dismissed.
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setKeys(await getApiKeys());
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const openCreate = () => {
    setNewKeyName('');
    setCreateError('');
    setCreatedKey(null);
    setCopied(false);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreatedKey(null);
    setCopied(false);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKeyName.trim()) {
      setCreateError('Give the key a name so you can recognise it later.');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const created = await createApiKey(newKeyName.trim());
      setCreatedKey(created.key);
      await loadKeys();
    } catch (err: any) {
      setCreateError(err?.response?.data?.message || 'Failed to create API key.');
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCreateError('Could not copy automatically — select the key and copy it manually.');
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    const confirmed = window.confirm(
      `Revoke "${key.name}" (${key.key_prefix}…)? Integrations using this key will stop working immediately.`,
    );
    if (!confirmed) return;
    setRevokingId(key.id);
    setError('');
    try {
      await revokeApiKey(key.id);
      await loadKeys();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to revoke API key.');
    } finally {
      setRevokingId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        header: 'NAME',
        accessor: (key: ApiKey) => (
          <span className="api-key-name-cell">
            <KeyRound size={14} />
            {key.name}
          </span>
        ),
        width: '220px',
      },
      {
        header: 'KEY',
        accessor: (key: ApiKey) => <code className="api-key-prefix">{key.key_prefix}…</code>,
        width: '190px',
      },
      { header: 'CREATED', accessor: (key: ApiKey) => formatDate(key.created_at), width: '130px' },
      { header: 'LAST USED', accessor: (key: ApiKey) => formatDate(key.last_used_at), width: '130px' },
      {
        header: 'STATUS',
        accessor: (key: ApiKey) => (
          <span className={`api-key-status ${key.revoked_at ? 'revoked' : 'active'}`}>
            {key.revoked_at ? 'Revoked' : 'Active'}
          </span>
        ),
        width: '110px',
      },
      {
        header: '',
        accessor: (key: ApiKey) =>
          key.revoked_at ? null : (
            <button
              type="button"
              className="api-key-revoke-btn"
              onClick={() => handleRevoke(key)}
              disabled={revokingId === key.id}
            >
              {revokingId === key.id ? 'Revoking…' : 'Revoke'}
            </button>
          ),
        width: '110px',
      },
    ],
    [revokingId],
  );

  return (
    <div className="api-keys-page">
      <PageHeader
        title="API Keys"
        subtitle="Connect your store to ParcelMoover — place and track orders programmatically."
        actionLabel="Generate Key"
        actionIcon={<Plus size={16} />}
        onAction={openCreate}
      />

      {error && <p className="api-keys-error">{error}</p>}

      <Table
        columns={columns}
        data={keys}
        selectable={false}
        loading={loading}
        loadingMessage="Loading API keys..."
        emptyMessage="No API keys yet. Generate one to start integrating."
        minWidth="880px"
      />

      <div className="api-keys-docs">
        <h3>Quick start</h3>
        <p>
          Send your key on every request as <code>Authorization: Bearer &lt;key&gt;</code>.
          Endpoints that change something also need a UUID <code>Idempotency-Key</code> header,
          so a retried request never repeats the action.
        </p>
        <ul>
          <li><code>POST /api/v1/orders</code> — place an order</li>
          <li><code>GET /api/v1/orders/&#123;trackingId&#125;</code> — track an order</li>
          <li><code>GET /api/v1/orders?status=delivered&amp;page=1</code> — list your orders</li>
          <li><code>POST /api/v1/orders/&#123;trackingId&#125;/cancel</code> — cancel an order</li>
          <li><code>POST /api/v1/orders/statuses</code> — bulk status lookup (up to 100 tracking ids)</li>
          <li><code>GET /api/v1/rates</code> · <code>GET /api/v1/rates/quote</code> — your rate card and single-destination quotes</li>
          <li><code>GET</code>/<code>POST /api/v1/orders/&#123;trackingId&#125;/remarks</code> — read or add order comments</li>
          <li><code>POST /api/v1/tickets</code> · <code>GET /api/v1/tickets</code> — open or list support tickets</li>
        </ul>
        <p>
          Full request/response shapes:{' '}
          <a
            className="api-keys-docs-link"
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI spec
          </a>
        </p>
      </div>

      {createOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>{createdKey ? 'Your new API key' : 'Generate API key'}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeCreate}>
                <X size={18} />
              </Button>
            </div>

            {createdKey ? (
              <>
                <p className="modal-desc">
                  Copy this key now — for security it will never be shown again.
                </p>
                <div className="api-key-reveal">
                  <code>{createdKey}</code>
                  <Button variant="secondary" onClick={copyKey}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {createError && <p className="api-keys-error">{createError}</p>}
                <div className="modal-footer">
                  <Button variant="primary" onClick={closeCreate}>Done</Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreate}>
                <p className="modal-desc">
                  Name the key after the store or system that will use it.
                </p>
                <label className="api-key-name-field">
                  <span>Key name</span>
                  <input
                    value={newKeyName}
                    onChange={(event) => setNewKeyName(event.target.value)}
                    placeholder="e.g. mystore.com production"
                    maxLength={100}
                    autoFocus
                  />
                </label>
                {createError && <p className="api-keys-error">{createError}</p>}
                <div className="modal-footer">
                  <Button variant="secondary" type="button" onClick={closeCreate}>Cancel</Button>
                  <Button variant="primary" type="submit" disabled={creating}>
                    {creating ? 'Generating…' : 'Generate Key'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorApiKeys;
