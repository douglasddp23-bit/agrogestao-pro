import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// As telas (frontend) ficam nesta pasta; o servidor (backend) fica em ../backend.
// O .env.local continua na raiz do projeto e o resultado do build continua em
// ../dist (é de lá que o servidor e o app de computador leem).
const ROOT = path.resolve(__dirname, '..');

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, ROOT, '');
  return {
    root: __dirname,
    envDir: ROOT,
    plugins: [react(), tailwindcss()],
    // SEGURANÇA: removido o "define" que copiava GEMINI_API_KEY para dentro do app
    // (qualquer código que a usasse no navegador exporia a chave paga a todos).
    // A IA é chamada só pelo servidor (/api/ai/*), que lê a chave do .env.local.
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      outDir: path.join(ROOT, 'dist'),
      emptyOutDir: true,
      // As páginas (Dashboard, Clients, etc.) já são carregadas sob demanda
      // (React.lazy em MainApp.tsx), mas tudo que é usado na tela de login
      // (React, Firebase, animações, ícones...) ainda ia junto num único
      // arquivo de ~1,6 MB, o que deixa o primeiro carregamento mais lento
      // — importante para quem acessa de internet mais fraca no campo.
      // Separar essas bibliotecas em pedaços próprios deixa esse arquivo
      // inicial bem menor e permite que o navegador baixe tudo em paralelo
      // e reaproveite esses pedaços em cache nas próximas atualizações do
      // sistema (eles mudam bem menos que o código do app em si).
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
            'vendor-ui': ['motion', 'lucide-react', 'sonner'],
          },
        },
      },
    },
  };
});
