import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket as TicketIcon } from 'lucide-react';
import Button from './Button';
import { getUnreadNotificationCountByType, subscribeToNotificationStream } from '../services/notifications.service';
import type { TicketCategory } from '../services/tickets.service';
import './TicketCategoryButton.css';

interface TicketCategoryButtonProps {
  /** Ticket category to deep-link to, e.g. 'pickup' | 'delivery' | 'cod_settlement'. */
  category: TicketCategory;
  /** Notification `type` this category's tickets are raised under (see ticket.service.ts's TICKET_CATEGORY_NOTIFICATIONS). */
  notificationType: string;
}

// Per-module ticket button (Pickup Operations / Local Dispatch / COD Management) -
// same "count badge that pops on click" pattern as TopNav's "Unclosed cmt" button,
// but scoped to one ticket category instead of the shared notification bell.
const TicketCategoryButton: React.FC<TicketCategoryButtonProps> = ({ category, notificationType }) => {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    getUnreadNotificationCountByType()
      .then((counts) => setCount(counts[notificationType] || 0))
      .catch(() => {});

    const unsubscribe = subscribeToNotificationStream((notification) => {
      if (notification.type === notificationType) {
        setCount((prev) => prev + 1);
      }
    });

    return unsubscribe;
  }, [notificationType]);

  return (
    <Button
      variant="outline"
      className="ticket-category-button"
      onClick={() => navigate(`/tickets?category=${category}`)}
    >
      <TicketIcon size={16} />
      Ticket
      {count > 0 && (
        <span className="ticket-category-badge" aria-label={`${count} unread ${category} tickets`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Button>
  );
};

export default TicketCategoryButton;
