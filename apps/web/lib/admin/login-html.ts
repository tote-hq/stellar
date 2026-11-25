/** Login document built by middleware. Inline CSS, no icons, no manifest. */

export const LOGIN_COPY = 'Usuario o contraseña incorrectos.';

export function loginDocument(failed: boolean): string {
  const alert = failed
    ? `<p role="alert" data-testid="admin-login-error">${LOGIN_COPY}</p>`
    : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Changuito · operación</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f1419; color: #f4f7fb; }
  @media (prefers-color-scheme: light) {
    body { background: #f7f4ef; color: #1c1915; }
  }
  main { max-width: 24rem; margin: 4rem auto; padding: 1.5rem; }
  h1 { font-size: 1.25rem; }
  label { display: block; margin-top: 1rem; }
  input { width: 100%; min-height: 44px; margin-top: 0.25rem; box-sizing: border-box; }
  button { min-height: 44px; min-width: 44px; margin-top: 1rem; }
  :focus-visible { outline: 3px solid #c45500; outline-offset: 2px; }
  [role="alert"] { margin-top: 1rem; }
</style>
</head>
<body>
<main data-testid="admin-login">
  <h1>Changuito · operación</h1>
  <form id="login" method="post" action="/api/admin/login">
    <label for="user">Usuario</label>
    <input id="user" name="username" autocomplete="username" required>
    <label for="pass">Contraseña</label>
    <input id="pass" name="password" type="password" autocomplete="current-password" required>
    <button type="submit" data-testid="admin-login-submit">Entrar</button>
  </form>
  ${alert}
</main>
<script>
  document.getElementById('login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
    });
    if (res.ok) { location.assign('/'); return; }
    location.assign('/?login=failed');
  });
</script>
</body>
</html>`;
}

export const LOGIN_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
};
