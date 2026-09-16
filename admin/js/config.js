// Configuração pública do Admin.
// A chave publicável do Supabase é feita para ficar no navegador: o acesso aos dados
// é controlado pelo login + RLS no banco. Nunca coloque a service_role aqui.
export const SUPABASE_URL = 'https://hebwwsgowdnttdevgrmo.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_d3QMEx24eJjEIZlRVnKOng_p9KQeZpw';

export const CDN = {
  supabase: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm',
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm',
  dompurify: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.15/+esm'
};
