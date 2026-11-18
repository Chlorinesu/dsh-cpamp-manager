import { useEffect, useMemo } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { createAppRoutes } from '../upstream/src/app/appRoutes';
import { setScopeRoute, setScopeNavigator } from './scope';

let lastLocation = '/';
/** Uses all original CPAMP routes without reading/writing the Harness URL. */
export function AppRouter() {
  const router = useMemo(() => {
    const initial = new URL(lastLocation, 'https://cpamp.invalid');
    setScopeRoute(initial.pathname, initial.search);
    return createMemoryRouter(createAppRoutes(), { initialEntries: [lastLocation] });
  }, []);
  useEffect(() => {
    const sync = () => {
      const location = router.state.location;
      lastLocation = location.pathname + location.search;
      setScopeRoute(location.pathname, location.search);
    };
    sync();
    setScopeNavigator(delta => { void router.navigate(delta); });
    const unsubscribe = router.subscribe(sync);
    return () => { setScopeNavigator(null); unsubscribe(); router.dispose(); };
  }, [router]);
  return <RouterProvider router={router} />;
}
