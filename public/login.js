const form = document.querySelector('#loginForm');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const loginButton = document.querySelector('#loginButton');
const loginButtonText = document.querySelector('#loginButtonText');
const loginMessage = document.querySelector('#loginMessage');
const setupRequiredBox = document.querySelector('#setupRequiredBox');
const transportNotice = document.querySelector('#transportNotice');
const capsWarning = document.querySelector('#capsWarning');
const togglePassword = document.querySelector('#togglePassword');
let retryTimer = null;

function setMessage(message, type = 'error') {
  loginMessage.textContent = String(message || '');
  loginMessage.className = `login-message ${type}`;
  loginMessage.classList.toggle('hidden', !message);
}

function setLoading(loading) {
  loginButton.disabled = loading;
  usernameInput.disabled = loading;
  passwordInput.disabled = loading;
  loginButton.classList.toggle('loading', loading);
  loginButtonText.textContent = loading ? 'Validando acesso...' : 'Entrar na aplicação';
}

function disableForSetup() {
  form.classList.add('hidden');
  setupRequiredBox.classList.remove('hidden');
}

function startRetryCountdown(seconds) {
  if (retryTimer) clearInterval(retryTimer);
  let remaining = Math.max(1, Number(seconds) || 1);
  loginButton.disabled = true;
  const update = () => {
    loginButtonText.textContent = `Tente novamente em ${remaining}s`;
    remaining -= 1;
    if (remaining < 0) {
      clearInterval(retryTimer);
      retryTimer = null;
      loginButton.disabled = false;
      loginButtonText.textContent = 'Entrar na aplicação';
    }
  };
  update();
  retryTimer = setInterval(update, 1000);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function checkSession() {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const payload = await readJson(response);
    if (payload && payload.authenticated) {
      window.location.replace('/');
      return;
    }
    if (payload && payload.setupRequired) disableForSetup();
    if (payload && payload.secureTransport === false && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      transportNotice.classList.remove('hidden');
    }
  } catch {
    setMessage('Não foi possível consultar o servidor. Verifique se a aplicação está em execução.');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    setMessage('Informe usuário e senha.');
    return;
  }

  setLoading(true);
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const error = payload && payload.error ? payload.error : `Falha de autenticação (HTTP ${response.status}).`;
      setMessage(error);
      if (response.status === 429) startRetryCountdown(payload && payload.retryAfterSeconds);
      else setLoading(false);
      passwordInput.select();
      return;
    }

    setMessage('Acesso autorizado. Abrindo o painel...', 'success');
    loginButtonText.textContent = 'Acesso autorizado';
    setTimeout(() => window.location.replace('/'), 250);
  } catch {
    setMessage('Não foi possível alcançar o servidor.');
    setLoading(false);
  }
});

passwordInput.addEventListener('keyup', (event) => {
  capsWarning.classList.toggle('hidden', !event.getModifierState('CapsLock'));
});
passwordInput.addEventListener('keydown', (event) => {
  capsWarning.classList.toggle('hidden', !event.getModifierState('CapsLock'));
});

togglePassword.addEventListener('click', () => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  togglePassword.textContent = showing ? 'Mostrar' : 'Ocultar';
  togglePassword.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  passwordInput.focus();
});

checkSession();
