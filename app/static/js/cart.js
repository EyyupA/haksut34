// Cart management using localStorage
const CART_KEY = 'haksut34_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, name, price, unit, qty = 1) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.product_id === productId);
  if (idx >= 0) {
    cart[idx].quantity += qty;
  } else {
    cart.push({ product_id: productId, name, price: parseFloat(price), unit, quantity: qty });
  }
  saveCart(cart);
  showAddedFeedback(productId);
}

function removeFromCart(productId) {
  const cart = getCart().filter(i => i.product_id !== productId);
  saveCart(cart);
}

function updateQuantity(productId, qty) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.product_id === productId);
  if (idx >= 0) {
    if (qty <= 0) {
      cart.splice(idx, 1);
    } else {
      cart[idx].quantity = qty;
    }
  }
  saveCart(cart);
}

function getCartTotal() {
  return getCart().reduce((sum, i) => sum + i.price * i.quantity, 0);
}

function getCartCount() {
  return getCart().reduce((sum, i) => sum + i.quantity, 0);
}

function updateCartBadge() {
  const count = getCartCount();
  const total = getCartTotal();
  document.querySelectorAll('.cart-badge').forEach(b => {
    b.textContent = count;
    b.style.display = count > 0 ? 'inline-flex' : 'none';
  });
  document.querySelectorAll('.cart-price').forEach(el => {
    el.textContent = total.toFixed(2).replace('.', ',') + ' €';
  });
}

function showAddedFeedback(productId) {
  const btn = document.querySelector(`[data-id="${productId}"]`);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.classList.add('added');
  btn.innerHTML = '✓';
  setTimeout(() => {
    btn.classList.remove('added');
    btn.innerHTML = orig;
  }, 1000);
}

// Render cart table on cart page
function renderCart(lang) {
  const cart = getCart();
  const tbody = document.getElementById('cart-tbody');
  const emptyMsg = document.getElementById('cart-empty');
  const cartContent = document.getElementById('cart-content');
  if (!tbody) return;

  if (cart.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    if (cartContent) cartContent.classList.add('hidden');
    return;
  }
  if (emptyMsg) emptyMsg.classList.add('hidden');
  if (cartContent) cartContent.classList.remove('hidden');

  tbody.innerHTML = '';
  cart.forEach(item => {
    const subtotal = (item.price * item.quantity).toFixed(2);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:700">${escHtml(item.name)}</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">${escHtml(item.unit || '')}</div>
      </td>
      <td>${item.price.toFixed(2)} €</td>
      <td>
        <input type="number" class="qty-input" value="${item.quantity}" min="1" max="99"
          onchange="updateQuantity(${item.product_id}, parseInt(this.value)||1); renderCart('${lang}'); updateTotals();">
      </td>
      <td style="font-weight:700">${subtotal} €</td>
      <td>
        <button class="btn-remove" onclick="removeFromCart(${item.product_id}); renderCart('${lang}'); updateTotals();" title="Entfernen">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  updateTotals();
}

function updateTotals() {
  const total = getCartTotal();
  const els = document.querySelectorAll('.cart-total-amount');
  els.forEach(el => el.textContent = total.toFixed(2) + ' €');
}

function buildItemsJson() {
  return JSON.stringify(getCart().map(i => ({
    product_id: i.product_id,
    name: i.name,
    quantity: i.quantity,
  })));
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();

  // Attach add-to-cart buttons
  document.querySelectorAll('.btn-add-cart').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const name = btn.dataset.name || btn.closest('.product-card')?.querySelector('.product-name')?.textContent || '';
      const price = btn.dataset.price;
      const unit = btn.dataset.unit || '';
      addToCart(id, name, price, unit);
    });
  });

  // Cart page init
  const lang = document.documentElement.lang || 'de';
  renderCart(lang);

  // Order form submit – inject items_json
  const orderForm = document.getElementById('order-form');
  if (orderForm) {
    orderForm.addEventListener('submit', e => {
      const cart = getCart();
      if (cart.length === 0) {
        e.preventDefault();
        alert('Ihr Warenkorb ist leer.');
        return;
      }
      document.getElementById('items-json-input').value = buildItemsJson();
      // Clear cart after submission so it doesn't linger
      setTimeout(() => saveCart([]), 500);
    });
  }
});
