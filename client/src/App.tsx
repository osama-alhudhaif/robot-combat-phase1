import { useRoute } from './ui/common';
import { Home } from './screens/Home';
import { Garage } from './screens/Garage';
import { Guide } from './screens/Guide';
import { Workshop } from './screens/Workshop';

export function App() {
  const route = useRoute();
  if (route[0] === 'garage') return <Garage />;
  if (route[0] === 'guide') return <Guide />;
  if (route[0] === 'robot' && route[1]) return <Workshop key={route[1]} id={route[1]} tab={route[2] === 'code' || route[2] === 'test' ? route[2] : 'build'} />;
  return <Home />;
}
