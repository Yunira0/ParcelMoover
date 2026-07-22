import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Copy, KeyRound, ListTree, Plus, Send, Webhook as WebhookIcon, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Table from '../../components/Table';
import Button from '../../components/Button';
import {
  createApiKey,
  getApiKeys,
  revokeApiKey,
  type ApiKey,
} from '../../services/apiKeys.service';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookDeliveries,
  getWebhookEndpoints,
  regenerateWebhookSecret,
  retryWebhookDelivery,
  sendTestWebhookEvent,
  updateWebhookEndpoint,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../../services/webhooks.service';
import { toBsDateTime } from '../../utils/nepaliDate';
import '../../components/Modal.css';
import './VendorApiKeys.css';
import './VendorWebhooks.css';

const formatDate = (value: string | null) => (value ? toBsDateTime(value) : '—');

type DeveloperTab = 'api-keys' | 'webhooks';

const webhookStatusLabel = (endpoint: WebhookEndpoint) => {
  if (endpoint.disabled_at) return 'Disabled (failing)';
  return endpoint.enabled ? 'Active' : 'Paused';
};
const webhookStatusClass = (endpoint: WebhookEndpoint) => {
  if (endpoint.disabled_at) return 'disabled';
  return endpoint.enabled ? 'active' : 'paused';
};

const VendorDeveloper: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DeveloperTab>(
    location.pathname.endsWith('/webhooks') ? 'webhooks' : 'api-keys',
  );

  const changeTab = (next: DeveloperTab) => {
    setTab(next);
    navigate(`/developer/${next}`, { replace: true });
  };

  // ── API keys state ──────────────────────────────────────────────────────
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState('');

  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createKeyError, setCreateKeyError] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError('');
    try {
      setKeys(await getApiKeys());
    } catch (err: any) {
      setKeysError(err?.response?.data?.message || 'Failed to load API keys.');
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const openCreateKey = () => {
    setNewKeyName('');
    setCreateKeyError('');
    setCreatedKey(null);
    setKeyCopied(false);
    setCreateKeyOpen(true);
  };
  const closeCreateKey = () => {
    setCreateKeyOpen(false);
    setCreatedKey(null);
    setKeyCopied(false);
  };

  const handleCreateKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKeyName.trim()) {
      setCreateKeyError('Give the key a name so you can recognise it later.');
      return;
    }
    setCreatingKey(true);
    setCreateKeyError('');
    try {
      const created = await createApiKey(newKeyName.trim());
      setCreatedKey(created.key);
      await loadKeys();
    } catch (err: any) {
      setCreateKeyError(err?.response?.data?.message || 'Failed to create API key.');
    } finally {
      setCreatingKey(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      setCreateKeyError('Could not copy automatically — select the key and copy it manually.');
    }
  };

  const handleRevokeKey = async (key: ApiKey) => {
    const confirmed = window.confirm(
      `Revoke "${key.name}" (${key.key_prefix}…)? Integrations using this key will stop working immediately.`,
    );
    if (!confirmed) return;
    setRevokingId(key.id);
    setKeysError('');
    try {
      await revokeApiKey(key.id);
      await loadKeys();
    } catch (err: any) {
      setKeysError(err?.response?.data?.message || 'Failed to revoke API key.');
    } finally {
      setRevokingId(null);
    }
  };

  const keyColumns = useMemo(
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
              onClick={() => handleRevokeKey(key)}
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

  // ── Webhooks state ──────────────────────────────────────────────────────
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(true);
  const [endpointsError, setEndpointsError] = useState('');

  const [createHookOpen, setCreateHookOpen] = useState(false);
  const [newHookName, setNewHookName] = useState('');
  const [newHookUrl, setNewHookUrl] = useState('');
  const [creatingHook, setCreatingHook] = useState(false);
  const [createHookError, setCreateHookError] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [hookCopied, setHookCopied] = useState(false);
  const [hookBusyId, setHookBusyId] = useState<string | null>(null);

  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState('');

  const loadEndpoints = useCallback(async () => {
    setEndpointsLoading(true);
    setEndpointsError('');
    try {
      setEndpoints(await getWebhookEndpoints());
    } catch (err: any) {
      setEndpointsError(err?.response?.data?.message || 'Failed to load webhook endpoints.');
    } finally {
      setEndpointsLoading(false);
    }
  }, []);

  useEffect(() => { loadEndpoints(); }, [loadEndpoints]);

  const openCreateHook = () => {
    setNewHookName('');
    setNewHookUrl('');
    setCreateHookError('');
    setRevealedSecret(null);
    setHookCopied(false);
    setCreateHookOpen(true);
  };
  const closeCreateHook = () => {
    setCreateHookOpen(false);
    setRevealedSecret(null);
    setHookCopied(false);
  };

  const handleCreateHook = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newHookName.trim() || !newHookUrl.trim()) {
      setCreateHookError('Give the endpoint a name and a URL.');
      return;
    }
    setCreatingHook(true);
    setCreateHookError('');
    try {
      const created = await createWebhookEndpoint(newHookName.trim(), newHookUrl.trim());
      setRevealedSecret(created.secret);
      await loadEndpoints();
    } catch (err: any) {
      setCreateHookError(err?.response?.data?.message || 'Failed to create webhook endpoint.');
    } finally {
      setCreatingHook(false);
    }
  };

  const copySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      setHookCopied(true);
      setTimeout(() => setHookCopied(false), 2000);
    } catch {
      setCreateHookError('Could not copy automatically — select the secret and copy it manually.');
    }
  };

  const handleDeleteHook = async (endpoint: WebhookEndpoint) => {
    const confirmed = window.confirm(
      `Delete "${endpoint.name}"? ParcelMoover will stop sending events to this URL immediately.`,
    );
    if (!confirmed) return;
    setHookBusyId(endpoint.id);
    setEndpointsError('');
    try {
      await deleteWebhookEndpoint(endpoint.id);
      await loadEndpoints();
    } catch (err: any) {
      setEndpointsError(err?.response?.data?.message || 'Failed to delete webhook endpoint.');
    } finally {
      setHookBusyId(null);
    }
  };

  const handleToggleEnabled = async (endpoint: WebhookEndpoint) => {
    setHookBusyId(endpoint.id);
    setEndpointsError('');
    try {
      await updateWebhookEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      await loadEndpoints();
    } catch (err: any) {
      setEndpointsError(err?.response?.data?.message || 'Failed to update webhook endpoint.');
    } finally {
      setHookBusyId(null);
    }
  };

  const handleRegenerate = async (endpoint: WebhookEndpoint) => {
    const confirmed = window.confirm(
      `Regenerate the secret for "${endpoint.name}"? The old secret stops verifying signatures immediately — update your endpoint before confirming.`,
    );
    if (!confirmed) return;
    setHookBusyId(endpoint.id);
    setEndpointsError('');
    try {
      const { secret } = await regenerateWebhookSecret(endpoint.id);
      setRevealedSecret(secret);
      setNewHookName(endpoint.name);
      setNewHookUrl(endpoint.url);
      setCreateHookOpen(true);
    } catch (err: any) {
      setEndpointsError(err?.response?.data?.message || 'Failed to regenerate secret.');
    } finally {
      setHookBusyId(null);
    }
  };

  const handleTest = async (endpoint: WebhookEndpoint) => {
    setHookBusyId(endpoint.id);
    setEndpointsError('');
    try {
      await sendTestWebhookEvent(endpoint.id);
    } catch (err: any) {
      setEndpointsError(err?.response?.data?.message || 'Failed to send test event.');
    } finally {
      setHookBusyId(null);
    }
  };

  const openDeliveries = async (endpoint: WebhookEndpoint) => {
    setDeliveriesFor(endpoint);
    setDeliveriesLoading(true);
    setDeliveriesError('');
    try {
      const { data } = await getWebhookDeliveries(endpoint.id);
      setDeliveries(data);
    } catch (err: any) {
      setDeliveriesError(err?.response?.data?.message || 'Failed to load deliveries.');
    } finally {
      setDeliveriesLoading(false);
    }
  };
  const closeDeliveries = () => {
    setDeliveriesFor(null);
    setDeliveries([]);
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    if (!deliveriesFor) return;
    try {
      await retryWebhookDelivery(deliveriesFor.id, deliveryId);
      await openDeliveries(deliveriesFor);
    } catch (err: any) {
      setDeliveriesError(err?.response?.data?.message || 'Failed to retry delivery.');
    }
  };

  const hookColumns = useMemo(
    () => [
      {
        header: 'NAME',
        accessor: (e: WebhookEndpoint) => (
          <span className="webhook-name-cell">
            <WebhookIcon size={14} />
            {e.name}
          </span>
        ),
        width: '200px',
      },
      {
        header: 'URL',
        accessor: (e: WebhookEndpoint) => <code className="webhook-url-cell">{e.url}</code>,
        width: '320px',
      },
      { header: 'CREATED', accessor: (e: WebhookEndpoint) => formatDate(e.created_at), width: '130px' },
      {
        header: 'STATUS',
        accessor: (e: WebhookEndpoint) => (
          <span className={`webhook-status ${webhookStatusClass(e)}`}>{webhookStatusLabel(e)}</span>
        ),
        width: '140px',
      },
      {
        header: '',
        accessor: (e: WebhookEndpoint) => (
          <div className="webhook-row-actions">
            <button type="button" className="webhook-action-btn" onClick={() => openDeliveries(e)} title="View deliveries">
              <ListTree size={14} /> Deliveries
            </button>
            <button type="button" className="webhook-action-btn" onClick={() => handleTest(e)} disabled={hookBusyId === e.id} title="Send a test event">
              <Send size={14} /> Test
            </button>
            <button type="button" className="webhook-action-btn" onClick={() => handleToggleEnabled(e)} disabled={hookBusyId === e.id}>
              {e.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" className="webhook-action-btn" onClick={() => handleRegenerate(e)} disabled={hookBusyId === e.id}>
              Roll secret
            </button>
            <button type="button" className="webhook-action-btn danger" onClick={() => handleDeleteHook(e)} disabled={hookBusyId === e.id}>
              Delete
            </button>
          </div>
        ),
        width: '360px',
      },
    ],
    [hookBusyId],
  );

  // ── Header content per tab ──────────────────────────────────────────────
  const headerProps = tab === 'api-keys'
    ? { actionLabel: 'Generate Key', actionIcon: <Plus size={16} />, onAction: openCreateKey }
    : { actionLabel: 'Add Endpoint', actionIcon: <WebhookIcon size={16} />, onAction: openCreateHook };

  return (
    <div className="api-keys-page">
      <PageHeader
        title="Developer"
        subtitle="Manage your Partner API keys and webhook endpoints in one place."
        {...headerProps}
      />

      <SegmentedTabs
        ariaLabel="Developer sections"
        value={tab}
        onChange={(v) => changeTab(v as DeveloperTab)}
        options={[
          { value: 'api-keys', label: 'API Keys' },
          { value: 'webhooks', label: 'Webhooks' },
        ]}
        fullWidth={false}
      />

      {tab === 'api-keys' ? (
        <>
          {keysError && <p className="api-keys-error">{keysError}</p>}

          <Table
            columns={keyColumns}
            data={keys}
            selectable={false}
            loading={keysLoading}
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
              <li><code>GET /api/v1/rates</code> · <code>GET /api/v1/rates/quote</code> — your rate card and single-destination quotes (accepts a hub name like <code>"Kathmandu"</code> or a UUID)</li>
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
        </>
      ) : (
        <>
          {endpointsError && <p className="webhooks-error">{endpointsError}</p>}

          <Table
            columns={hookColumns}
            data={endpoints}
            selectable={false}
            loading={endpointsLoading}
            loadingMessage="Loading webhook endpoints..."
            emptyMessage="No webhook endpoints yet. Add one to start receiving order.status_changed events."
            minWidth="1150px"
          />

          <div className="webhooks-docs">
            <h3>Quick start</h3>
            <p>
              We POST a JSON body to your URL on every order status change, signed via the{' '}
              <code>X-ParcelMoover-Signature</code> header (<code>t=&lt;unix_ts&gt;,v1=&lt;hmac_sha256&gt;</code>).
              Verify it with your endpoint secret before trusting the payload.
            </p>
            <ul>
              <li>Currently fires <code>order.status_changed</code> for every tracked order.</li>
              <li>Failed deliveries retry with backoff for up to ~24 hours.</li>
              <li>An endpoint that keeps failing is automatically disabled — resume it once it's fixed.</li>
            </ul>
          </div>
        </>
      )}

      {createKeyOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>{createdKey ? 'Your new API key' : 'Generate API key'}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeCreateKey}>
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
                    {keyCopied ? <Check size={14} /> : <Copy size={14} />}
                    {keyCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {createKeyError && <p className="api-keys-error">{createKeyError}</p>}
                <div className="modal-footer">
                  <Button variant="primary" onClick={closeCreateKey}>Done</Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreateKey}>
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
                {createKeyError && <p className="api-keys-error">{createKeyError}</p>}
                <div className="modal-footer">
                  <Button variant="secondary" type="button" onClick={closeCreateKey}>Cancel</Button>
                  <Button variant="primary" type="submit" disabled={creatingKey}>
                    {creatingKey ? 'Generating…' : 'Generate Key'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {createHookOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>{revealedSecret ? 'Your webhook secret' : 'Add webhook endpoint'}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeCreateHook}>
                <X size={18} />
              </Button>
            </div>

            {revealedSecret ? (
              <>
                <p className="modal-desc">
                  Copy this secret now — for security it will never be shown again. Use it to verify the{' '}
                  <code>X-ParcelMoover-Signature</code> header on every delivery.
                </p>
                <div className="webhook-secret-reveal">
                  <code>{revealedSecret}</code>
                  <Button variant="secondary" onClick={copySecret}>
                    {hookCopied ? <Check size={14} /> : <Copy size={14} />}
                    {hookCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {createHookError && <p className="webhooks-error">{createHookError}</p>}
                <div className="modal-footer">
                  <Button variant="primary" onClick={closeCreateHook}>Done</Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreateHook}>
                <p className="modal-desc">
                  We'll POST an <code>order.status_changed</code> event here whenever one of your orders changes status.
                </p>
                <label className="webhook-field">
                  <span>Name</span>
                  <input
                    value={newHookName}
                    onChange={(event) => setNewHookName(event.target.value)}
                    placeholder="e.g. mystore.com order sync"
                    maxLength={100}
                    autoFocus
                  />
                </label>
                <label className="webhook-field">
                  <span>Endpoint URL</span>
                  <input
                    value={newHookUrl}
                    onChange={(event) => setNewHookUrl(event.target.value)}
                    placeholder="https://mystore.com/webhooks/parcelmoover"
                    maxLength={2048}
                  />
                </label>
                {createHookError && <p className="webhooks-error">{createHookError}</p>}
                <div className="modal-footer">
                  <Button variant="secondary" type="button" onClick={closeCreateHook}>Cancel</Button>
                  <Button variant="primary" type="submit" disabled={creatingHook}>
                    {creatingHook ? 'Adding…' : 'Add Endpoint'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {deliveriesFor && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '720px' }}>
            <div className="modal-header">
              <h2>Deliveries — {deliveriesFor.name}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeDeliveries}>
                <X size={18} />
              </Button>
            </div>

            {deliveriesError && <p className="webhooks-error">{deliveriesError}</p>}

            {deliveriesLoading ? (
              <p className="modal-desc">Loading…</p>
            ) : deliveries.length === 0 ? (
              <p className="modal-desc">No deliveries yet.</p>
            ) : (
              <div className="webhook-deliveries-list">
                {deliveries.map((d) => (
                  <div key={d.id} className="webhook-delivery-row">
                    <div className="webhook-delivery-main">
                      <span className={`delivery-status ${d.status}`}>{d.status}</span>
                      <span className="delivery-event-type">{d.event_type}</span>
                      <span className="delivery-meta">
                        attempt {d.attempt_count}
                        {d.last_status_code ? ` · HTTP ${d.last_status_code}` : ''}
                      </span>
                      <span className="delivery-meta">{formatDate(d.created_at)}</span>
                    </div>
                    {d.last_error && <p className="delivery-error">{d.last_error}</p>}
                    {d.status === 'failed' && (
                      <button type="button" className="webhook-action-btn" onClick={() => handleRetryDelivery(d.id)}>
                        Retry now
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorDeveloper;
