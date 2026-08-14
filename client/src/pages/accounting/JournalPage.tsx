import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import JournalTab from './tabs/JournalTab';
import { hasAdminPermission } from '../../utils/auth';
import './Accounting.css';

// The day book. Every entry the system has ever posted, newest first.
//
// This is the entry-level view of the same data the Transactions screens show
// line by line: there, an entry paying four expense categories out of cash is
// one cash payment; here it is one entry with five lines.
//
// The New entry button lives here rather than inside JournalTab because the
// modal has to reload that tab's own list after saving, so the tab owns the
// modal and this owns the button that opens it.

const JournalPage: React.FC = () => {
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');

  return (
    <div className="acc-page">
      <PageHeader
        title="Journal Entries"
        subtitle="Every entry the books hold, newest first"
        actionLabel={canWrite ? 'New entry' : undefined}
        actionIcon={<Plus size={16} />}
        onAction={() => setNewEntryOpen(true)}
      />

      <JournalTab newEntryOpen={newEntryOpen} onNewEntryClose={() => setNewEntryOpen(false)} />
    </div>
  );
};

export default JournalPage;
