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
        gap: '12px',
        padding: '12px 16px',
        background: 'var(--bg-elevated, #161b22)',
        borderTop: '1px solid var(--border-color, #30363d)',
        borderRadius: '0 0 var(--radius-md, 8px) var(--radius-md, 8px)',
        fontSize: '0.85rem',
        color: 'var(--text-dim, #8b949e)',
      }}
    >
      {/* Item range summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>
          Showing{' '}
          <strong style={{ color: 'var(--text-main, #f0f6fc)' }}>
            {startItem.toLocaleString()}–{endItem.toLocaleString()}
          </strong>{' '}
          of{' '}
          <strong style={{ color: 'var(--text-main, #f0f6fc)' }}>
            {totalItems.toLocaleString()}
          </strong>{' '}
          items
        </span>
      </div>

      {/* Navigation Buttons & Page List */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #30363d)',
            background: page <= 1 ? 'transparent' : 'var(--bg-color, #0d1117)',
            color: page <= 1 ? 'var(--text-disabled, #484f58)' : 'var(--text-main, #f0f6fc)',
            cursor: page <= 1 ? 'not-allowed' : 'pointer',
            fontSize: '0.82rem',
            fontWeight: 500,
          }}
        >
          Previous
        </button>

        {pages.map((p, idx) => {
          if (p === '...') {
            return (
              <span key={`ellipsis-${idx}`} style={{ padding: '0 4px', color: 'var(--text-dim, #8b949e)' }}>
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
                minWidth: '28px',
                height: '28px',
                padding: '0 6px',
                borderRadius: '6px',
                border: isCurrent ? '1px solid var(--primary, #38bdf8)' : '1px solid var(--border-color, #30363d)',
                background: isCurrent ? 'var(--primary-soft, rgba(56, 189, 248, 0.15))' : 'var(--bg-color, #0d1117)',
                color: isCurrent ? 'var(--primary, #38bdf8)' : 'var(--text-main, #f0f6fc)',
                cursor: 'pointer',
                fontSize: '0.82rem',
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
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #30363d)',
            background: page >= totalPages ? 'transparent' : 'var(--bg-color, #0d1117)',
            color: page >= totalPages ? 'var(--text-disabled, #484f58)' : 'var(--text-main, #f0f6fc)',
            cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            fontSize: '0.82rem',
            fontWeight: 500,
          }}
        >
          Next
        </button>
      </div>

      {/* Page Size Selector (if onPageSizeChange provided) */}
      {onPageSizeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>Show:</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            style={{
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #30363d)',
              background: 'var(--bg-color, #0d1117)',
              color: 'var(--text-main, #f0f6fc)',
              fontSize: '0.82rem',
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
