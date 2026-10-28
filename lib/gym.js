// Gym content shared by the landing page and the booking flow

const site = {
  name: 'Iron Dunes CrossFit',
  area: 'Khalifa City, Abu Dhabi',
  locality: 'Khalifa City',
  tagline: 'Stronger every single day',
  address: 'Warehouse 12, Khalifa City, Abu Dhabi',
  phone: '+971 50 123 4567',
  brand: 'London International',
  brandUrl: 'https://lisrc.ae',
  author: 'Hadi',
};

const coaches = [
  { name: 'Khalid Nasser', role: 'Head Coach', cert: 'CF-L3', speciality: 'CrossFit WOD and conditioning' },
  { name: 'Maya Ross', role: 'Coach', cert: 'CF-L2', speciality: 'Open Gym and general CrossFit coaching' },
  { name: 'Tom Becker', role: 'Coach', cert: 'Olympic Lifting', speciality: 'snatch and clean & jerk technique' },
  { name: 'Noor Saleh', role: 'Coach', cert: 'Foundations', speciality: 'beginners and learning the basic movements' },
];

const prices = [
  { name: 'Drop-in class', price: 'AED 80' },
  { name: '10-class pack', price: 'AED 650' },
  { name: 'Unlimited monthly', price: 'AED 900' },
];

// `coach` is the coach who runs every session of that class type
const classes = [
  { key: 'wod', name: 'CrossFit WOD', icon: 'bi-fire', coach: 'Khalid Nasser', text: 'High-intensity, constantly varied workout of the day — scaled for every level.' },
  { key: 'olympic', name: 'Olympic Lifting', icon: 'bi-trophy', coach: 'Tom Becker', text: 'Master the snatch and clean & jerk with technique-first coaching.' },
  { key: 'foundations', name: 'Foundations', icon: 'bi-bricks', coach: 'Noor Saleh', text: 'Beginners start here: learn the core movements safely before joining WODs.' },
  { key: 'open-gym', name: 'Open Gym', icon: 'bi-door-open', coach: 'Maya Ross', text: 'Your time, our kit — train your own programme with coaches on the floor.' },
];

const schedule = [
  { day: 'Monday', times: ['6:00 am', '7:00 am', '6:00 pm', '7:00 pm'] },
  { day: 'Tuesday', times: ['6:00 am', '7:00 am', '6:00 pm', '7:00 pm'] },
  { day: 'Wednesday', times: ['6:00 am', '7:00 am', '6:00 pm', '7:00 pm'] },
  { day: 'Thursday', times: ['6:00 am', '7:00 am', '6:00 pm', '7:00 pm'] },
  { day: 'Friday', times: ['9:00 am'] },
  { day: 'Saturday', times: ['8:00 am', '9:00 am'] },
  { day: 'Sunday', times: [] },
];

// Column order for the desktop schedule table
const timeSlots = ['6:00 am', '7:00 am', '8:00 am', '9:00 am', '6:00 pm', '7:00 pm'];

const hours = [
  { days: 'Mon – Thu', time: '5:30 am – 9:00 pm' },
  { days: 'Friday', time: '8:30 am – 11:00 am' },
  { days: 'Saturday', time: '7:30 am – 11:00 am' },
  { days: 'Sunday', time: 'Closed' },
];

const booking = {
  capacity: 12,          // athletes per session
  sessionMinutes: 60,
  daysAhead: 30,         // how far ahead people can book
  cancelCutoffMinutes: 120, // athletes can cancel online up to 2 hours before class
  dropIn: { amount: 8000, currency: 'aed', label: 'AED 80' }, // amount in fils (smallest unit)
  checkoutMinutes: 30,   // a Pending booking holds its spot this long while the athlete pays
  timeZone: 'Asia/Dubai',
  utcOffset: '+04:00',   // Asia/Dubai has no daylight saving; used when storing session times
};

const assistant = {
  name: 'Ask Iron Dunes',
  signOff: '— Hadi Dina, powered by Hadi Cross Fit',
};

module.exports = { site, coaches, classes, schedule, timeSlots, hours, booking, prices, assistant };
