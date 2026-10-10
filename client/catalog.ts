// size : Go téléchargés depuis vel.gg au premier lancement (morceaux Brotli des manifestes du 2026-10-09).
// first : Five garde les adresses racine du site (/manifest.json, /pack/, soit /bo1z/… chez vel.gg).
export type GameMap = { era: string; slug: string; zone: string; name: string; place: string; size: number; horde?: boolean; first?: boolean; desc: string };

export const MAPS: GameMap[] = [
  { era: 'World at War', slug: 'nacht', zone: 'zombie_cod5_prototype', name: 'Nacht der Untoten', place: 'Un bunker abandonné', size: 0.28, horde: true,
    desc: 'L’originale : tenir dans un petit bunker face à des vagues sans fin.' },
  { era: 'World at War', slug: 'verruckt', zone: 'zombie_cod5_asylum', name: 'Verrückt', place: 'Asile de Wittenau, Berlin', size: 0.31, horde: true,
    desc: 'Un asile abandonné, et l’équipe séparée en deux dès le départ.' },
  { era: 'World at War', slug: 'shinonuma', zone: 'zombie_cod5_sumpf', name: 'Shi No Numa', place: 'Un avant-poste dans les marais, Japon', size: 0.30, horde: true,
    desc: 'Des cabanes à ouvrir et des tyroliennes au-dessus du marais.' },
  { era: 'World at War', slug: 'riese', zone: 'zombie_cod5_factory', name: 'Der Riese', place: 'Usine du Groupe 935, Breslau', size: 0.34, horde: true,
    desc: 'Le Géant se réveille. Affrontez les zombies nazis au cœur de leur territoire, là où le grand plan a pris forme.' },
  { era: 'Black Ops', slug: 'kino', zone: 'zombie_theater', name: 'Kino der Toten', place: 'Un théâtre, Berlin', size: 0.33, horde: true,
    desc: 'Combattez les morts dans ce théâtre abandonné. De nouveaux indices pourraient révéler le plan final. Que le spectacle commence !' },
  { era: 'Black Ops', slug: 'five', zone: 'zombie_pentagon', name: '« Five »', place: 'Le Pentagone, Washington', size: 0.32, horde: true, first: true,
    desc: 'Le Pentagone est attaqué ! Washington passe en DEFCON 1.' },
  { era: 'Black Ops', slug: 'ascension', zone: 'zombie_cosmodrome', name: 'Ascension', place: 'Un cosmodrome soviétique', size: 0.33,
    desc: 'Modules lunaires, singes de l’espace et une fusée prête à partir.' },
  { era: 'Black Ops', slug: 'cotd', zone: 'zombie_coast', name: 'Call of the Dead', place: 'Un phare gelé, Sibérie', size: 0.33,
    desc: 'Un phare pris dans la glace, un navire échoué, et George A. Romero à vos trousses.' },
  { era: 'Black Ops', slug: 'shangrila', zone: 'zombie_temple', name: 'Shangri-La', place: 'Un temple dans la jungle', size: 0.34,
    desc: 'Pièges, geysers et wagonnet dans un temple perdu.' },
  { era: 'Black Ops', slug: 'moon', zone: 'zombie_moon', name: 'Moon', place: 'Griffin Station, la Lune', size: 0.40,
    desc: 'De la Zone 51 à une base lunaire : gravité réduite, et pas d’air dehors.' },
];
