import { useRoute } from './services/router.ts';
import { CanvasPage } from './components/CanvasPage.tsx';
import { ProjectListPage } from './components/ProjectListPage.tsx';

export function App() {
  const route = useRoute();
  if (route.page === 'canvas') {
    // Keyed so switching projects remounts the canvas with fresh state.
    return <CanvasPage key={route.projectId} projectId={route.projectId} />;
  }
  return <ProjectListPage />;
}

export default App;
