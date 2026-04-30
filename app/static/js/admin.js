// Admin panel interactivity

document.addEventListener('DOMContentLoaded', () => {
  // Confirm dialogs for destructive actions
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm)) {
        e.preventDefault();
      }
    });
  });

  // Auto-submit filter form on select change
  document.querySelectorAll('.auto-submit').forEach(el => {
    el.addEventListener('change', () => el.closest('form').submit());
  });

  // Image preview on file select
  const imgInput = document.getElementById('image-file-input');
  const imgPreview = document.getElementById('image-preview');
  if (imgInput && imgPreview) {
    imgInput.addEventListener('change', () => {
      const file = imgInput.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = e => {
          imgPreview.src = e.target.result;
          imgPreview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Modal cancel order
  setupModal('cancel-modal', 'cancel-order-btn', 'cancel-modal-close', 'cancel-modal-confirm');
  setupModal('lock-modal', 'lock-order-btn', 'lock-modal-close', 'lock-modal-confirm');
});

function setupModal(modalId, triggerSelector, closeBtnId, confirmBtnId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  const trigger = document.getElementById(triggerSelector);
  const close = document.getElementById(closeBtnId);
  const confirm = document.getElementById(confirmBtnId);

  if (trigger) trigger.addEventListener('click', () => modal.classList.remove('hidden'));
  if (close) close.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}
