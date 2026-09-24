import { useRoute } from './services/router.ts';
import { CanvasPage } from './components/CanvasPage.tsx';
import { ProjectListPage } from './components/ProjectListPage.tsx';
import { DialogProvider, ToastProvider } from './components/ui/index.ts';

function Routes() {
  const route = useRoute();
  if (route.page === 'canvas') {
    // Keyed so switching projects remounts the canvas with fresh state.
    return <CanvasPage key={route.projectId} projectId={route.projectId} />;
  }
  return <ProjectListPage />;
}

export function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <Routes />
      </DialogProvider>
    </ToastProvider>
  );
}

export default App;
