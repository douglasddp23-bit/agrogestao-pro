import React from 'react';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/auth/LoginPage';
import ResetPasswordRequired from './components/auth/ResetPasswordRequired';

// Carregados sob demanda: antes o sistema inteiro (e a biblioteca de PDF da
// assinatura remota) vinha junto com a tela de login, deixando a abertura lenta.
const loadMainApp = () => import('./components/layout/MainApp');
const MainApp = React.lazy(loadMainApp);
const RemoteSignature = React.lazy(() => import('./pages/RemoteSignature'));

function LoadingScreen() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 bg-emerald-600 rounded-xl animate-pulse flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-emerald-200">A</div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse mt-2">Carregando Sistema...</p>
      </div>
    </div>
  );
}

function AuthWrapper() {
  const { user, loading } = useAuth();

  // Enquanto a pessoa digita a senha, já baixa o sistema em segundo plano:
  // depois do login ele abre sem esperar.
  React.useEffect(() => {
    const t = setTimeout(() => { loadMainApp().catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, []);

  // Intercept public remote signature route before anything else
  const isRemoteSign = window.location.pathname.startsWith('/assinar/');

  if (isRemoteSign) {
    const contractId = window.location.pathname.split('/').pop() || '';
    return (
      <>
        <Toaster position="top-right" richColors expand={false} />
        <React.Suspense fallback={<LoadingScreen />}>
          <RemoteSignature contractId={contractId} />
        </React.Suspense>
      </>
    );
  }

  if (loading) {
    return <LoadingScreen />;
  }

  // Mandatory multi-factor-like redirection gate for mustChangePassword compliance
  if (user && user.mustChangePassword) {
    return (
      <>
        <Toaster position="top-right" richColors expand={false} />
        <ResetPasswordRequired />
      </>
    );
  }

  return (
    <>
      <Toaster position="top-right" richColors expand={false} />
      {user ? (
        <React.Suspense fallback={<LoadingScreen />}>
          <MainApp />
        </React.Suspense>
      ) : <LoginPage />}
    </>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  props!: { children: React.ReactNode };
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: any) { console.error("Global Error Caught:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900 text-white font-sans text-center">
          <h2 className="text-2xl font-bold text-rose-400">Desculpe, ocorreu um erro inesperado.</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-md">{this.state.error?.message || "Erro desconhecido"}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-xs uppercase tracking-wider transition-all">Recarregar Sistema</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthWrapper />
      </AuthProvider>
    </ErrorBoundary>
  );
}
