/* ============================================================================
   THE SHOW: every slide, in order.  This is the only file to edit for content.

   REORDER   move a { ... } block up or down. Numbers on screen follow.
   REMOVE    delete the block, or add  skip: true  to keep it but hide it.
   ADD       copy a block, give it a new id.

   A slide opens on its TITLE, then each entry in  steps  is one more press of
   the arrow key (a "phase").  noTitle: true  skips the title screen, so the
   slide opens straight on its first step with the title above it.

   FILES     anything named in  file:  is looked for in  media/  which is your
             DropFolder. Until a file with that exact name is there, the slide
             shows a clean placeholder that tells you the name it is waiting for.

   STEP TYPES
     tree      { type:'tree', items:[ 'Name', or { k:'1991', name, line, hot:true } ] }
               the title shrinks and the lines draw out of it, on one screen
     media     { type:'media', items:[ { kind:'video'|'image'|'audio', file, label } ] }
     ads       { type:'ads', items:[ { src, w, h, z (zoom), label }, { stack:[ ... ] } ] }
     showcase  { type:'showcase', items:[ { name, src (a live page) or file, kind, note } ] }
               each item is its own press of the arrow key
     icons     { type:'icons', items:[ { name, line, mark, icon (optional file) } ] }
     list      { type:'list', items:[ { name, line } ] }
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

    { id: 'years', title: '1987 to 2000', sub: 'Marketer and technologist.', aliases: ['1987', 'timeline', 'career', 'growth'],
      steps: [
        { type: 'tree', label: 'Growth', grow: true, x0: 660, x1: 930, key: 'Technology', items: [
          { k: 'Pre-87', name: 'Computer programming', hot: true },
          { k: '1987', name: 'Art direction', line: 'Yellow Pages design' },
          { k: '1988', name: 'Freelance business' },
          { k: '1991', name: 'Ackerman McQueen', line: 'Art director' },
          { k: '1993', name: 'Ackerman McQueen', line: 'Broadcast producer' },
          { k: '1995', name: 'Ackerman McQueen', line: 'Internet producer, new media', hot: true },
          { k: '2000', name: 'Founded StapleGun' },
          { k: '2000+', name: 'Running an agency', line: 'Clients, process, new business, creative direction' }
        ] }
      ] },

    { id: 'last-6-years', title: 'The Last 6 Years', sub: 'Speed to market.' },

    { id: 'agency', title: 'Agency from my chair.', aliases: ['clients', 'chair'],
      steps: [
        { type: 'tree', label: 'Clients', items: [
          'AcrobatAnt', 'Perillo Tours', 'Ruby Tuesday', 'Mazzio’s', 'The Learning Center',
          'Oklahoma Education Impact Initiative', 'Omega Motion', 'VIP Luxury Seating',
          'BibleDiscovery.app', 'Assist AI',
          /* added from the project folders. Delete any that do not belong: */
          'Honda · Acura', 'RibCrib', 'Brock Institute', 'Tulsa Sound Originals'
        ] }
      ] },

    { id: 'mazzios', title: 'Mazzio’s', noTitle: true,
      steps: [
        { type: 'media', label: 'Movies', items: [
          { kind: 'video', file: 'mazzios-1.mp4', label: 'Movie 1' },
          { kind: 'video', file: 'mazzios-2.mp4', label: 'Movie 2' }
        ] }
      ] },

    { id: 'okeii', title: 'OKEII', noTitle: true, aliases: ['oklahoma education impact initiative'],
      steps: [
        { type: 'media', label: 'The website', items: [
          { kind: 'image', file: 'okeii-website.jpg', label: 'Website' }
        ] },
        { type: 'media', label: 'Movies', items: [
          { kind: 'video', file: 'okeii-1.mp4', label: 'Movie 1' },
          { kind: 'video', file: 'okeii-2.mp4', label: 'Movie 2' },
          { kind: 'video', file: 'okeii-3.mp4', label: 'Movie 3' }
        ] }
      ] },

    { id: 'honda-acura', title: 'Honda Acura', noTitle: true, aliases: ['honda', 'acura'],
      steps: [
        { type: 'media', label: 'Social', items: [
          { kind: 'video', file: 'honda-social-a.mp4', label: 'Honda social' },
          { kind: 'video', file: 'acura-social-a.mp4', label: 'Acura social' }
        ] },
        { type: 'ads', label: 'Digital', items: [
          { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/HND_300x600_A/index.html', w: 300, h: 600, z: 1.1, label: 'Honda 300 × 600' },
          { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/ACR_300x600_A/index.html', w: 300, h: 600, z: 1.1, label: 'Acura 300 × 600' },
          { stack: [
            { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/HND_728x90_A/index.html', w: 728, h: 90, label: 'Honda 728 × 90' },
            { src: '/AcrobatAnt-HNDACR-Fall-Digital/rounds/rv2/ads/ACR_728x90_A/index.html', w: 728, h: 90, label: 'Acura 728 × 90' }
          ] }
        ] }
      ] },

    { id: 'app-development', title: 'App Development', noTitle: true, aliases: ['apps'],
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

    { id: 'voice-agents', title: 'Voice Agents', aliases: ['voice'],
      steps: [
        { type: 'showcase', items: [
          { name: 'Catapult', src: 'https://catapultcreative.agency/', note: 'catapultcreative.agency' },
          { name: 'Lady on Main', file: 'lady-on-main.jpg', kind: 'image',
            note: 'Waiting on the site address, or drop lady-on-main.jpg.' },
          { name: 'AechTech', src: 'https://aechtech.com/', note: 'aechtech.com' }
        ] }
      ] },

    { id: 'research', title: 'Research', noTitle: true,
      steps: [
        { type: 'list', items: [
          { name: 'Market study', line: 'Who is in the category, what they say, where the gap is.' },
          { name: 'Client deep dive', line: 'Site, social, press and reviews read before the first meeting.' },
          { name: 'Audience and message', line: 'Who we are talking to, in their own words.' },
          { name: 'Competitive creative review', line: 'What the other guys are running, side by side.' },
          { name: 'Search and AI-answer audit', line: 'How a brand shows up in Google and in the AI answers.' },
          { name: 'Media and spec research', line: 'Every vendor size and deadline, captured before production.' }
        ] }
      ] },

    { id: 'seo', title: 'SEO', noTitle: true, aliases: ['search'],
      steps: [
        { type: 'media', label: 'Search Console', items: [
          { kind: 'image', file: 'search-console.png', label: 'Search Console screenshot' }
        ] }
      ] },

    { id: 'custom-everything', title: 'Custom Everything', aliases: ['custom'],
      steps: [
        { type: 'showcase', items: [
          { name: 'Social Admin', file: 'brock-social-admin.png', kind: 'image',
            note: 'Brock Institute. One desk that proposes, drafts, reviews and schedules.' },
          { name: 'Honda Acura Ad Builder', src: 'embeds/leaf-lab/leaves-lab.html',
            note: 'Built for the Honda and Acura fall work.' }
        ] }
      ] },

    { id: 'second-brain', title: 'Second Brain', noTitle: true, aliases: ['brain'],
      steps: [
        { type: 'media', label: 'A page in the brain', items: [
          { kind: 'image', file: 'second-brain.png', label: 'Second Brain page' }
        ] }
      ] },

    { id: 'accounting', title: 'Accounting' },

    { id: 'recent-examples', title: 'Recent Examples', aliases: ['recent'] },

    { id: 'voice-casting', title: 'Voice Casting', sub: 'Sound 1, 2, 3. RibCrib.', aliases: ['rib crib', 'ribcrib', 'casting'],
      steps: [
        { type: 'media', label: 'RibCrib', items: [
          { kind: 'audio', file: 'voice-1.mp3', label: 'Sound 1' },
          { kind: 'audio', file: 'voice-2.mp3', label: 'Sound 2' },
          { kind: 'audio', file: 'voice-3.mp3', label: 'Sound 3' }
        ] }
      ] },

    { id: 'press-videos', title: 'Press Videos', aliases: ['press'],
      steps: [
        { type: 'media', label: 'OKEII press', items: [
          { kind: 'video', file: 'press-1.mp4', label: 'Press video' }
        ] },
        { type: 'showcase', items: [
          { name: 'Deployment package', src: '/OKEII-SRA-Deployment/',
            note: 'OKEII. Every deliverable against the date it has to hit.' }
        ] }
      ] },

    { id: 'mounted-flapped', title: 'Mounted & Flapped', aliases: ['mounted and flapped', 'deployment'],
      steps: [
        { type: 'showcase', items: [
          { name: 'OKEII', src: '/OKEII-SRA-Deployment/',
            note: 'The deployment package. Every deliverable against the date it has to hit.' },
          { name: 'Honda Acura', src: 'embeds/honda-fall-board.html',
            note: 'The deployment package, as the client saw it.' }
        ] }
      ] },

    { id: 'building-a-team', title: 'Building a Team', sub: 'Talk Scale', aliases: ['team'],
      steps: [
        { type: 'teams', label: 'The team', lead: { name: 'Grokbot', line: 'Coordinates the work' }, teams: [
          { name: 'Video Production', rows: [
            ['Copy', ['Claude']],
            ['Concept', ['ChatGPT']],
            ['Storyboards', ['XYZ']],
            ['Video scenes', ['Runway', 'Google AI Studio']],
            ['Audio', ['ElevenLabs']]
          ] },
          { name: 'Print Production', rows: [
            ['Design', ['Claude']],
            ['Images', ['ChatGPT']],
            ['Resizes', ['Illustrator']],
            ['Proofing', ['Claude']]
          ] },
          { name: 'Digital', rows: [
            ['Websites', ['Claude Code']],
            ['Display ads', ['Claude Code']],
            ['Apps', ['Claude Code']],
            ['Search', ['Claude']],
            ['Voice agents', ['ElevenLabs']]
          ] },
          { name: 'Social', rows: [
            ['Ideas', ['Claude', 'ChatGPT', 'Grok']],
            ['Posts', ['Claude']],
            ['Animated ads', ['After Effects']],
            ['Schedule', ['Claude']]
          ] },
          { name: 'Administration', rows: [
            ['Email', ['Grok']],
            ['Billing', ['Claude']],
            ['Calendar', ['Grok']],
            ['Second Brain', ['Claude']]
          ] },
          { name: 'Account Service', rows: [
            ['Research', ['Claude']],
            ['Proposals', ['Claude']],
            ['Status reports', ['Grok']],
            ['Presentations', ['Claude Code']]
          ] }
        ] }
      ] },

    { id: 'org-chart', title: 'Org Chart', aliases: ['org'],
      steps: [
        { type: 'org',
          top: { name: 'Philip', line: 'Creative director. Final say.' },
          chief: { name: 'Bill', line: 'Chief of staff · Grokbot' },
          staff: [
            { name: 'Koty', line: 'Build' }, { name: 'Corey' }, { name: 'Creative', line: 'Production' },
            { name: 'EmailBuddy', line: 'Inbox' }, { name: 'Accounting', line: 'Billing' }, { name: 'Admin' }
          ],
          models: [
            { name: 'Claude', line: 'Copy, design, code' }, { name: 'ChatGPT', line: 'Images, concepts' },
            { name: 'Grok', line: 'Admin' }, { name: 'Runway', line: 'Video' },
            { name: 'Google AI Studio', line: 'Video' }, { name: 'ElevenLabs', line: 'Voice, music' }
          ],
          foot: 'Agents propose. Philip decides.' }
      ] },

    { id: 'source-of-truth', title: 'One Source of Truth',
      sub: 'A bunch of agents are chaos. A team.', aliases: ['truth'] },

    { id: 'stack-vs-slop', title: 'The Stack vs. The Slop', aliases: ['stack', 'slop'] },

    { id: 'rate-of-change', title: 'Rate of Change' },

    { id: 'open-for-business', title: 'Open for Business', aliases: ['open', 'close', 'end'] }

  ]
};
