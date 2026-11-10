/**
 * IIIT Bhubaneswar Mess Management System
 * Shared Frontend JavaScript Utilities
 */

// XSS Sanitizer: safely escape user-generated strings
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Toast notification system
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.style.animation = 'fadeOut 0.2s forwards';
    setTimeout(() => toast.remove(), 200);
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'fadeOut 0.2s forwards';
      setTimeout(() => toast.remove(), 200);
    }
  }, duration);
}

// API helper: wraps fetch, includes credentials, handles JSON and error alerts
async function api(endpoint, options = {}) {
  const defaultOptions = {
    credentials: 'include',
    headers: {}
  };

  const config = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {})
    }
  };

  // If body is an object and not FormData, stringify to JSON
  if (config.body && !(config.body instanceof FormData) && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
    config.headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(endpoint, config);

    // If 401 Unauthorized, redirect to login page (unless already on auth page)
    if (res.status === 401) {
      const isAuthPage = window.location.pathname.endsWith('index.html') ||
                         window.location.pathname.endsWith('register.html') ||
                         window.location.pathname === '/' ||
                         window.location.pathname === '/login';
      if (!isAuthPage) {
        showToast('Session expired. Please log in again.', 'warning');
        setTimeout(() => {
          window.location.href = '/index.html';
        }, 800);
      }
    }

    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = { message: await res.text() };
    }

    if (!res.ok) {
      const errorMsg = data.message || data.error || `Request failed with status ${res.status}`;
      showToast(errorMsg, 'error');
      const err = new Error(errorMsg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    if (!err.status) {
      // Network error or unexpected exception
      showToast(err.message || 'Network connection failed', 'error');
    }
    throw err;
  }
}

// Current user state cached in memory
let currentUser = null;

// Auth check on page load: checks /api/auth/me and enforces role access
async function checkAuth(requiredRole = null) {
  try {
    const res = await api('/api/auth/me');
    if (!res.user) {
      redirectToLogin();
      return null;
    }

    currentUser = res.user;

    // Role check
    const role = currentUser.role;
    if (requiredRole) {
      const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!allowedRoles.includes(role)) {
        showToast(`Access denied for role '${role}'`, 'error');
        // Redirect to user's home dashboard
        if (role === 'student') window.location.href = '/student/dashboard.html';
        else if (role === 'admin') window.location.href = '/admin/dashboard.html';
        else if (role === 'superadmin') window.location.href = '/superadmin/dashboard.html';
        return null;
      }
    }

    // Populate user profile elements if present on page
    populateUserInfo(currentUser);

    return currentUser;
  } catch (err) {
    if (err.status === 401) {
      redirectToLogin();
    }
    return null;
  }
}

// Helper: redirect to login
function redirectToLogin() {
  const isAuthPage = window.location.pathname.endsWith('index.html') ||
                     window.location.pathname.endsWith('register.html') ||
                     window.location.pathname === '/' ||
                     window.location.pathname === '/login';
  if (!isAuthPage) {
    window.location.href = '/index.html';
  }
}

// Populate user details across topbar and sidebar
function populateUserInfo(user) {
  if (!user) return;

  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = user.name;

  const rollEl = document.getElementById('user-roll');
  if (rollEl) rollEl.textContent = user.roll_no;

  const roleEl = document.getElementById('user-role');
  if (roleEl) roleEl.textContent = user.role.toUpperCase();

  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    avatarEl.textContent = (user.name || 'U').charAt(0).toUpperCase();
  }

  // Show Mess Wallet balance badge in student topbar
  if (user.role === 'student') {
    const walletVal = formatCurrency(user.wallet_balance || 0);
    const walletEl = document.getElementById('user-wallet');
    if (walletEl) {
      walletEl.textContent = walletVal;
    } else {
      const topbar = document.querySelector('.topbar');
      const badge = topbar?.querySelector('.user-badge');
      if (topbar && badge && !document.getElementById('topbar-wallet-chip')) {
        const chip = document.createElement('a');
        chip.id = 'topbar-wallet-chip';
        chip.href = '/student/payment-history.html';
        chip.className = 'badge badge-active';
        chip.style.marginRight = '0.75rem';
        chip.style.textDecoration = 'none';
        chip.title = 'Mess Wallet Balance (Click to view wallet ledger)';
        chip.innerHTML = `Wallet: <strong id="user-wallet" style="margin-left:4px;">${walletVal}</strong>`;
        const rightWrap = document.createElement('div');
        rightWrap.className = 'flex items-center';
        badge.parentNode.insertBefore(rightWrap, badge);
        rightWrap.appendChild(chip);
        rightWrap.appendChild(badge);
      }
    }
  }

  // Enable seamless two-way navigation between Super Admin & Admin portals for superadmin users
  if (user.role === 'superadmin') {
    const sidebarMenu = document.querySelector('.sidebar-menu');
    if (sidebarMenu && !document.getElementById('superadmin-cross-nav')) {
      const path = window.location.pathname;
      const wrapper = document.createElement('div');
      wrapper.id = 'superadmin-cross-nav';
      wrapper.style.marginTop = '0.75rem';
      wrapper.style.paddingTop = '0.75rem';
      wrapper.style.borderTop = '1px solid var(--border-light)';

      if (path.includes('/admin/')) {
        wrapper.innerHTML = `
          <div class="text-xs text-muted fw-bold" style="padding: 0.25rem 0.85rem; letter-spacing: 0.5px;">SUPER ADMIN PORTAL</div>
          <a href="/superadmin/dashboard.html" class="nav-link">&larr; Super Admin Dashboard</a>
          <a href="/superadmin/daily-reports.html" class="nav-link">Daily Reports</a>
          <a href="/superadmin/manage-admins.html" class="nav-link">Manage Admins</a>
          <a href="/superadmin/settings.html" class="nav-link">Mess Settings</a>
        `;
        sidebarMenu.appendChild(wrapper);
      } else if (path.includes('/superadmin/')) {
        wrapper.innerHTML = `
          <div class="text-xs text-muted fw-bold" style="padding: 0.25rem 0.85rem; letter-spacing: 0.5px;">ADMIN OPERATIONS</div>
          <a href="/admin/dashboard.html" class="nav-link">Admin Dashboard</a>
          <a href="/admin/verify-payments.html" class="nav-link">Verify Payments</a>
          <a href="/admin/manage-menu.html" class="nav-link">Manage Menu</a>
          <a href="/admin/mark-claims.html" class="nav-link">Mark Claims</a>
          <a href="/admin/spot-coupon.html" class="nav-link">Spot Coupon</a>
          <a href="/admin/leave-requests.html" class="nav-link">Leave Requests</a>
          <a href="/admin/complaints.html" class="nav-link">Complaints</a>
          <a href="/admin/students.html" class="nav-link">Students</a>
        `;
        sidebarMenu.appendChild(wrapper);
      }
    }
  }
}

// Logout handler
async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    showToast('Logged out successfully', 'success');
  } catch (err) {
    // Continue redirect even if API call fails
  } finally {
    window.location.href = '/index.html';
  }
}

// IST YYYY-MM-DD helpers
function getISTTodayString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function addISTDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

// Format date helper: returns "09 Nov 2026"
function formatDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

// Format currency helper: returns "₹50.00"
function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return '₹' + num.toFixed(2);
}

// Status badge helper: returns HTML badge string
function renderBadge(status) {
  if (!status) return '';
  const s = String(status).toLowerCase();
  const label = s.replace(/_/g, ' ');
  return `<span class="badge badge-${s}">${label}</span>`;
}

// Mobile sidebar toggle setup
function initSidebar() {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');

  if (!toggleBtn || !sidebar) return;

  // Create backdrop if needed
  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
  });

  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });
}

// Auto-run on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();

  // Attach global logout listener to any button with data-logout attribute
  document.querySelectorAll('[data-logout]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  });
});
