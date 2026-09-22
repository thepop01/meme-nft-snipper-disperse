import React from 'react';

/**
 * Reusable Pagination component for data-heavy table views.
 *
 * @param {Object} props
 * @param {number} props.currentPage - Current 1-based page
 * @param {number} props.totalPages - Total pages available
 * @param {number} props.totalItems - Total item count across all pages
 * @param {number} props.pageSize - Current page size
 * @param {Function} props.onPageChange - Handler receiving new page number
 * @param {Function} [props.onPageSizeChange] - Optional handler receiving new page size
 * @param {number[]} [props.pageSizeOptions=[25, 50, 100]] - Array of selectable page sizes
 */
export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  pageSize = 50,
  onPageChange = () => {},
  onPageSizeChange = null,
  pageSizeOptions = [25, 50, 100],
}) {
  const page = Math.max(1, Math.min(currentPage, Math.max(1, totalPages)));
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems);

  // Compute windowed page numbers: always show 1, last, and window around current
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [];
    const left = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);

    pages.push(1);
    if (left > 2) {
      pages.push('...');
    }
    for (let i = left; i <= right; i++) {
      pages.push(i);
    }
    if (right < totalPages - 1) {
      pages.push('...');
    }
    pages.push(totalPages);
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '8px 12px',
        background: 'var(--bg-elevated, #ffffff)',
        borderTop: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '0 0 var(--radius-md, 6px) var(--radius-md, 6px)',
        fontSize: '0.75rem',
        color: 'var(--text-dim, #6b7280)',
      }}
    >
      {/* Item range summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>
          Showing{' '}
          <strong style={{ color: 'var(--text-main, #111827)' }}>
            {startItem.toLocaleString()}–{endItem.toLocaleString()}
          </strong>{' '}
          of{' '}
          <strong style={{ color: 'var(--text-main, #111827)' }}>
            {totalItems.toLocaleString()}
          </strong>{' '}
          items
        </span>
      </div>

      {/* Navigation Buttons & Page List */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border-color, #e5e7eb)',
            background: page <= 1 ? 'transparent' : 'var(--bg-color, #ffffff)',
            color: page <= 1 ? 'var(--text-disabled, #9ca3af)' : 'var(--text-main, #111827)',
            cursor: page <= 1 ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem',
            fontWeight: 500,
          }}
        >
          Previous
        </button>

        {pages.map((p, idx) => {
          if (p === '...') {
            return (
              <span key={`ellipsis-${idx}`} style={{ padding: '0 3px', color: 'var(--text-dim, #9ca3af)' }}>
                …
              </span>
            );
          }
          const isCurrent = p === page;
          return (
            <button
              key={`page-${p}`}
              type="button"
              onClick={() => onPageChange(p)}
              style={{
                minWidth: '24px',
                height: '24px',
                padding: '0 4px',
                borderRadius: '4px',
                border: isCurrent ? '1px solid var(--primary, #5046e5)' : '1px solid var(--border-color, #e5e7eb)',
                background: isCurrent ? 'var(--primary-soft, rgba(80, 70, 229, 0.1))' : 'var(--bg-color, #ffffff)',
                color: isCurrent ? 'var(--primary, #5046e5)' : 'var(--text-main, #111827)',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: isCurrent ? 700 : 500,
              }}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border-color, #e5e7eb)',
            background: page >= totalPages ? 'transparent' : 'var(--bg-color, #ffffff)',
            color: page >= totalPages ? 'var(--text-disabled, #9ca3af)' : 'var(--text-main, #111827)',
            cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem',
            fontWeight: 500,
          }}
        >
          Next
        </button>
      </div>

      {/* Page Size Selector (if onPageSizeChange provided) */}
      {onPageSizeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-color, #e5e7eb)',
              background: 'var(--bg-color, #ffffff)',
              color: 'var(--text-main, #111827)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>
                {opt} / page
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
