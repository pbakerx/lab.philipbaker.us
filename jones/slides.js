/* ============================================================================
   THE SHOW: every slide, in order.  This is the only file to edit for content.

   REORDER   move a { ... } block up or down. Numbers on screen follow.
   REMOVE    delete the block, or add  skip: true  to keep it but hide it.
   ADD       copy a block, give it a new id.

   A slide opens on its TITLE, then each entry in  steps  is one more press of
   the arrow key (a "phase").  noTitle: true  skips the title screen, so the
   slide opens straight on its first step with the title above it.

   autoAdvance: 5000  holds the opening screen for that many milliseconds, then
             advances to the next screen of the same slide. A key press during the
             wait cancels the timer, so it will not double-advance.

   FILES     anything named in  file:  is looked for in  media/  which is your
             DropFolder. Until a file with that exact name is there, the slide
             shows a clean placeholder that tells you the name it is waiting for.

   STEP TYPES
     tree      { type:'tree', items:[ 'Name', or { k:'1991', name, line, hot:true } ] }
               bold:true  sets a name in black.  bigSubs:true  makes that item's small lines larger and bold.
               the title shrinks and the lines draw out of it, on one screen
     media     { type:'media', items:[ { kind:'video'|'image'|'audio', file, label } ] }
     ads       { type:'ads', items:[ { src, w, h, z (zoom), label }, { stack:[ ... ] } ] }
     showcase  { type:'showcase', items:[ { name, src (a live page) or file, kind, note } ] }
               each item is its own press of the arrow key
     icons     { type:'icons', items:[ { name, line, mark, icon (optional file) } ] }
     list      { type:'list', items:[ { name, line } ], big:true for a large typographic list }
     teams / org    the two diagrams near the end; their words are below.
               A tool's logo is used if  DropFolder/icons/<name>.svg  exists
               (claude.svg, chatgpt.svg, grok.svg, runway.svg, elevenlabs.svg ...).
   ========================================================================== */

window.SHOW = {
  name: 'Jones PR',
  date: 'Nov 20, 2026',

  /* The remote agent's line. Change "room" here AND in api/jonesshow.js together. */
  remote: { on: true, room: 'jones-pr-7f3k9q2x' },

  slides: [

    { id: 'intelligence-age', title: 'The Intelligence Age',
      sub: 'Change. Change. Change. Overwhelming.' },

    { id: 'years', title: '1987 to 2020', sub: 'First in on every new technology.', autoAdvance: 5000, aliases: ['1987', 'timeline', 'career', 'growth'],
      steps: [
        { type: 'tree', label: 'Growth', grow: true, x0: 660, x1: 930, items: [
          { k: 'Pre-87', name: 'Computer programming', bold: true },
          { k: '1987–1988', name: 'Freelance', items: ['Art direction', 'Yellow Pages design', 'Desktop publishing'] },
          { k: '1991–1999', name: 'Ackerman McQueen', bigSubs: true, items: ['Created Mac Network', 'Created Digital Video Department', 'Created Internet Department'] },
          { k: '2000–2020', name: 'StapleGun', items: ['All of it, at scale, with people'] }
        ] }
      ] },

    { id: 'last-6-years', title: 'The Last 6 Years', sub: 'Speed to market.' },

    { id: 'agency', title: 'Agency from my chair.', autoAdvance: 5000, aliases: ['clients', 'chair'],
      steps: [
        { type: 'tree', label: 'Clients', items: [
          'AcrobatAnt', 'Pokes with a Purpose', 'NIL-OSU Athletics', 'Perillo Tours', 'Ruby Tuesday', 'Mazzio’s', 'The Learning Center',
          'Oklahoma Education Impact Initiative', 'Cause for Effect', 'VIP Luxury Seating',
          'BibleDiscovery.app', 'Assist AI',
          /* added from the project folders. Delete any that do not belong: */
          'Honda · Acura', 'Brock Institute', 'Tulsa Sound Originals'
        ] }
      ] },

    { id: 'mazzios', title: 'Mazzio’s', noTitle: true,
      steps: [
        { type: 'media', label: 'Cheezzy Bread', grid: 3, items: [
          { kind: 'image', file: 'mazzios-cheezzy-1.jpg', label: 'Turn up the Cheezzy' },
          { kind: 'image', file: 'mazzios-cheezzy-2.jpg', label: 'Cheezzy Cheese bread' },
          { kind: 'image', file: 'mazzios-cheezzy-3.jpg', label: 'Bread and sauce' },
          { kind: 'image', file: 'mazzios-cheezzy-4.jpg', label: 'Cheezzy close-up' },
          { kind: 'image', file: 'mazzios-cheezzy-5.jpg', label: 'Badge centered' },
          { kind: 'image', file: 'mazzios-cheezzy-6.jpg', label: 'Mazzio’s end card' }
        ] }
      ] },

    { id: 'okeii', title: 'OKEII', noTitle: true, aliases: ['oklahoma education impact initiative'],
      steps: [
        { type: 'media', label: 'Spots', grid: 3, items: [
          { kind: 'image', file: 'okeii-grid-1.jpg', label: 'OK 50th in public education' },
          { kind: 'image', file: 'okeii-grid-2.jpg', label: 'The Strong Readers Act' },
          { kind: 'image', file: 'okeii-grid-3.jpg', label: 'More reading coaches' },
          { kind: 'image', file: 'okeii-grid-4.jpg', label: 'Help me' },
          { kind: 'image', file: 'okeii-grid-5.jpg', label: '1-in-6 third graders' },
          { kind: 'image', file: 'okeii-grid-6.jpg', label: 'Help us' },
          { kind: 'image', file: 'okeii-grid-7.jpg', label: '1-in-6, with speaker' },
          { kind: 'image', file: 'okeii-grid-8.jpg', label: 'Think critically and creatively' },
          { kind: 'image', file: 'okeii-grid-9.jpg', label: "Help strengthen Oklahoma's reading laws" }
        ] }
      ] },

    { id: 'honda-acura', title: 'Honda Acura', noTitle: true, aliases: ['honda', 'acura'],
      steps: [
        { type: 'media', label: 'Social', grid: 3, square: true, muted: true, autoplay: true,
          facts: ['3,672 videos', '918 dealers', '722 Honda  ·  196 Acura', 'A/B  ·  1:1 & 9:16'],
          tech: 'AE + CSV automation', items: [
          { kind: 'video', file: 'honda-social-sq-a.mp4', label: 'Honda A' },
          { kind: 'video', file: 'honda-social-sq-b.mp4', label: 'Honda B' },
          { kind: 'video', file: 'acura-social-sq-a.mp4', label: 'Acura A' },
          { kind: 'video', file: 'acura-social-sq-b.mp4', label: 'Acura B' },
          { kind: 'video', file: 'honda-summer-social-sq.mp4', label: 'Summer' }
        ] },
        { type: 'ads', label: 'Digital',
          facts: ['18,216 ads', '36 ad units', '876 dealers', '687 Honda  ·  189 Acura', '6 sizes  ·  A, B, RT'],
          tech: 'HTML5 + CSV', items: [
          { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/HND_300x600_A/index.html', w: 300, h: 600, z: 1.1, label: 'Honda 300 × 600' },
          { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/ACR_300x600_A/index.html', w: 300, h: 600, z: 1.1, label: 'Acura 300 × 600' },
          { stack: [
            { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/HND_728x90_A/index.html', w: 728, h: 90, label: 'Honda 728 × 90' },
            { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/ACR_728x90_A/index.html', w: 728, h: 90, label: 'Acura 728 × 90' }
          ] }
        ] }
      ] },

    { id: 'app-development', title: 'App and Web Development', noTitle: true, aliases: ['apps'],
      steps: [
        { type: 'icons', items: [
          { name: 'BibleDiscovery.app', line: 'Scripture study app', mark: 'BD' },
          { name: 'Widget Maker', line: 'Type a wish, get a working widget', mark: 'WM' },
          { name: 'Assist AI', line: 'AI assistant product', mark: 'Ai' },
          { name: 'My Assist Hearing', line: 'Hearing companion app', mark: 'MH' },
          { name: 'Roast Machine', line: 'iPhone app', mark: 'RM' },
          { name: 'PlainPaste', line: 'Mac menu bar utility', mark: 'PP' },
          { name: 'Pocket GPT', line: 'A real GPT that trains in the page', mark: 'PG' },
          { name: 'Maze Wars+', line: 'Online multiplayer, in a browser', mark: 'MW' },
          { name: 'Emergence', line: 'Web app', mark: 'Em' },
          { name: 'CheckMate', line: 'Chess analysis', mark: 'CM' },
          { name: 'What’s That Video', line: 'Video lookup', mark: 'WV' }
        ] }
      ] },

    { id: 'research', title: 'Proactive Autonomy', noTitle: true,
      aliases: ['seo', 'search', 'adwords', 'media', 'research', 'proactive autonomy', 'proactive'],
      steps: [
        { type: 'list', big: true, items: [
          { name: 'Proactive Autonomy', items: ['Research', 'SEO', 'AdWords', 'Media'] }
        ] }
      ] },

    { id: 'custom-everything', title: 'Custom Everything', aliases: ['custom'],
      steps: [
        { type: 'showcase', items: [
          { name: 'Honda Acura Ad Builder', src: 'embeds/leaf-lab/leaves-lab.html',
            note: 'Built for the Honda and Acura fall work.' }
        ] }
      ] },

    { id: 'recent-examples', title: 'Recent Examples', aliases: ['recent'] },

    { id: 'press-videos', title: 'Press Videos', noTitle: true, aliases: ['press'],
      steps: [
        { type: 'media', label: 'OKEII', grid: 3, muted: true, autoplay: true,
          facts: ['17 press videos', '16 soundbites  ·  1 story', '16:9 and 9:16'],
          tech: 'OKEII  ·  Oct 29, 2026', items: [
          { kind: 'video', file: 'press-ashdyn-story.mp4', label: "Ashdyn's Story" },
          { kind: 'video', file: 'press-literacy-needle.mp4', label: 'Literacy Moves the Needle' },
          { kind: 'video', file: 'press-superhighway.mp4', label: 'Superhighway vs Back Roads' },
          { kind: 'video', file: 'press-26-to-95.mp4', label: '26% to 95%' },
          { kind: 'video', file: 'press-stay-the-course.mp4', label: 'Stay the Course' },
          { kind: 'video', file: 'press-marathon.mp4', label: 'A Marathon, Not a Miracle' }
        ] }
      ] },

    { id: 'mounted-flapped', title: 'Mounted & Flapped', aliases: ['mounted and flapped', 'deployment'],
      steps: [
        { type: 'showcase', items: [
          { name: 'OKEII', src: 'https://lab.philipbaker.us/OKEII-SRA-Deployment/#scoreboard/digital',
            note: 'The deployment package. Every deliverable against the date it has to hit.' }
        ] }
      ] },

    { id: 'org-chart', title: 'Building a Team', aliases: ['org', 'org chart', 'building a team'],
      steps: [
        { type: 'org',
          top: { name: 'Philip', line: 'Creative director. Final say.' },
          chief: { name: 'Bill', line: 'Chief of staff · Grokbot' },
          categories: ['Video production', 'Print production', 'Digital', 'Social', 'Administration', 'Account service'],
          staff: [
            { name: 'Koty', line: 'Build' }, { name: 'Corey' }, { name: 'Creative', line: 'Production' },
            { name: 'EmailBuddy', line: 'Inbox' }, { name: 'Accounting', line: 'Billing' }, { name: 'Admin' }
          ],
          models: [
            { name: 'Claude', line: 'Copy, design, code' }, { name: 'ChatGPT', line: 'Images, concepts' },
            { name: 'Grok', line: 'Admin' }, { name: 'Runway', line: 'Video' },
            { name: 'Google AI Studio', line: 'Video' }, { name: 'Kling', line: 'Video' },
            { name: 'ElevenLabs', line: 'Voice, music' }
          ],
          foot: 'Agents propose. Philip decides.' }
      ] },

    { id: 'stack-vs-slop', title: 'The Stack vs. The Slop', aliases: ['stack', 'slop'] },

    { id: 'rate-of-change', title: 'Rate of Change' },

    { id: 'open-for-business', title: 'Open for Business', aliases: ['open', 'close', 'end'] }

  ]
};
