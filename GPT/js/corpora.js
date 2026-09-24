// Training texts. Dinosaur names are facts; the rhymes are traditional and
// public domain; the fortunes are written for this page; Copycat is generated.
'use strict';
window.CORPORA = (function () {
  const dinos = `Allosaurus Ankylosaurus Apatosaurus Archaeopteryx Argentinosaurus Baryonyx Brachiosaurus
Brontosaurus Camarasaurus Carnotaurus Ceratosaurus Coelophysis Compsognathus Corythosaurus Deinonychus
Dilophosaurus Diplodocus Dracorex Edmontosaurus Einiosaurus Eoraptor Gallimimus Giganotosaurus Herrerasaurus
Hadrosaurus Iguanodon Kentrosaurus Lambeosaurus Leptoceratops Maiasaura Megalosaurus Microraptor
Minmi Mosasaurus Nodosaurus Ornithomimus Oviraptor Pachycephalosaurus Parasaurolophus Pentaceratops
Plateosaurus Protoceratops Psittacosaurus Saltasaurus Sauropelta Scelidosaurus Spinosaurus Stegosaurus
Struthiomimus Styracosaurus Suchomimus Therizinosaurus Torosaurus Triceratops Troodon Tyrannosaurus
Utahraptor Velociraptor Zuniceratops Albertosaurus Amargasaurus Anchisaurus Avimimus Bambiraptor
Camptosaurus Chasmosaurus Citipati Daspletosaurus Dromaeosaurus Euoplocephalus Gorgosaurus Hypsilophodon
Irritator Mamenchisaurus Massospondylus Megaraptor Muttaburrasaurus Ouranosaurus Pachyrhinosaurus
Qianzhousaurus Rugops Sauroposeidon Shunosaurus Sinosauropteryx Stygimoloch Tarbosaurus Tenontosaurus
Thescelosaurus Tsintaosaurus Yangchuanosaurus Zalmoxes Nigersaurus Majungasaurus Cryolophosaurus
Europasaurus Gasosaurus Leaellynasaura Mapusaurus Nothronychus Pelecanimimus Rajasaurus Scutellosaurus`
    .split(/\s+/).map(s => s.toLowerCase()).join('\n') + '\n';

  const rhymes = `twinkle, twinkle, little star,
how i wonder what you are!
up above the world so high,
like a diamond in the sky.

humpty dumpty sat on a wall,
humpty dumpty had a great fall.
all the king's horses and all the king's men
couldn't put humpty together again.

jack and jill went up the hill
to fetch a pail of water.
jack fell down and broke his crown,
and jill came tumbling after.

mary had a little lamb,
its fleece was white as snow;
and everywhere that mary went,
the lamb was sure to go.

hey diddle diddle,
the cat and the fiddle,
the cow jumped over the moon;
the little dog laughed
to see such sport,
and the dish ran away with the spoon.

baa, baa, black sheep,
have you any wool?
yes sir, yes sir,
three bags full.

hickory dickory dock,
the mouse ran up the clock.
the clock struck one,
the mouse ran down,
hickory dickory dock.

little bo peep has lost her sheep,
and doesn't know where to find them.
leave them alone, and they'll come home,
wagging their tails behind them.

old mother hubbard
went to the cupboard
to give the poor dog a bone;
when she came there,
the cupboard was bare,
and so the poor dog had none.
`;

  const fortunes = `you will find a sock you lost in 2019.
a pleasant surprise is waiting in your inbox.
the snack you are thinking of is a good idea.
today is a fine day to water a plant.
someone admires your excellent spreadsheet.
a small robot will learn to spell your name.
you will soon take a nap you truly deserve.
your next cup of coffee will be perfect.
luck favors the person who reads the manual.
a great idea will arrive while you are in the shower.
you will win an argument with a vending machine.
the stars suggest you should back up your files.
an old friend will send you a very long voice memo.
you will pet a good dog this week.
a mystery will be solved by turning it off and on again.
your code will compile on the first try. eventually.
the moon approves of your playlist.
you will learn something delightful about octopuses.
a door will open. please close it behind you.
you will soon be very good at a very niche skill.
fortune favors the curious and the well snacked.
someone will laugh at your joke a little too hard.
the answer is in the second drawer.
you will find the perfect parking spot.
a tiny machine is learning to write this sentence.
`;

  function copycat() {
    const abc = 'abcdefghijklmnopqrstuvwxyz';
    let s = 1, out = '';
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    while (out.length < 7000) {
      const len = 3 + Math.floor(r() * 3);
      let w = ''; for (let i = 0; i < len; i++) w += abc[Math.floor(r() * 26)];
      out += w + '>' + w + '\n';
    }
    return out;
  }

  return [
    { id: 'dinos', label: 'Dinosaurs', blurb: 'Learns to invent new dinosaur names.', text: dinos },
    { id: 'rhymes', label: 'Nursery rhymes', blurb: 'Old rhymes, remixed into new nonsense.', text: rhymes },
    { id: 'fortunes', label: 'Fortune cookies', blurb: 'Writes its own questionable fortunes.', text: fortunes },
    { id: 'copycat', label: 'Copycat', blurb: 'Random words it must repeat after the ">". Only attention can do this: watch a head learn to look back.', text: copycat() },
  ];
})();
