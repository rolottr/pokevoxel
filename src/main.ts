import './styles.css';
import { PokevoxelApp } from './app/PokevoxelApp';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Pokevoxel mount point is missing.');

new PokevoxelApp(root);
