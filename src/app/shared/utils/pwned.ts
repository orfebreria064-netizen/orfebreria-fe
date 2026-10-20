/**
 * ¿La contraseña aparece en filtraciones conocidas? Consulta Have I Been Pwned con k-anonimato:
 * solo se envían los 5 primeros caracteres del SHA-1; la contraseña nunca sale del navegador.
 * Si el servicio no responde, no se bloquea al usuario (devuelve false).
 */
export async function isPwnedPassword(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return false;
    return (await res.text()).split('\n').some((line) => {
      const [s, count] = line.trim().split(':');
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
