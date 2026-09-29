import type { Order, ParcelStatus } from '../services/orders.service';
import { downloadExcel } from './excel';
import { toBsDateTimeCell } from './nepaliDate';
import { ORDER_STATUS_LABELS, STATUS_TIMELINE_HEADERS, statusTimelineCells } from './orderStatus';

// The Orders page's Excel layout, shared so every "download these orders"
// button produces the same sheet. Orders need statusTimestamps for the
// timeline columns - fetch them with `withArrival: true`.
export function downloadOrdersExcel(
  filename: string,
  sheetName: string,
  orders: Order[],
  statusLabels: Record<ParcelStatus, string> = ORDER_STATUS_LABELS,
): void {
  const headers = ['Order ID', 'Tracking ID', 'Origin', 'Sender', 'Receiver', 'Receiver Phone', 'Alternate Number', 'Receiver Address', 'Destination', 'COD', 'Delivery Charge', 'Weight', 'Status', 'Rider', 'Remarks', 'Order Created Date', 'Last Updated By', 'Last Updated At', ...STATUS_TIMELINE_HEADERS];
  const rows = orders.map(order => [
    `#${order.orderNumber}`,
    order.trackingId,
    order.origin,
    order.senderName,
    order.receiverName,
    order.receiverPhone || '',
    order.receiverAlternatePhone || '',
    order.receiverAddress || '',
    order.destination,
    order.codAmount,
    order.deliveryCharge,
    order.weightKg || '',
    statusLabels[order.status],
    order.riderName || '',
    order.remarks || '',
    toBsDateTimeCell(order.createdAtRaw || order.createdAt) || '',
    order.lastUpdatedBy || '',
    toBsDateTimeCell(order.lastUpdatedAt) || '',
    ...statusTimelineCells(order.statusTimestamps),
  ]);
  downloadExcel(filename, sheetName, headers, rows);
}
