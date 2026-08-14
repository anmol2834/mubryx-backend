const fs = require('fs');

const filePath = 'C:/technician-dashboard/src/screens/ActiveJobs/constants/index.ts';

const content = `import { JobStatus, StatusTab } from '../types';

// ─── Colors ───────────────────────────────────────────────────────────────────

export const AJColors = {
  // Base
  ink: '#111111',
  white: '#FFFFFF',
  surface: '#F7F7F9',
  surfaceCard: '#FFFFFF',

  // Borders
  border: '#EBEBEB',
  borderLight: '#F2F2F2',

  // Text
  textPrimary: '#111111',
  textSecondary: '#6B6B6B',
  textMuted: '#9A9A9A',

  // Status — Assigned (Blue)
  statusAssigned: '#208AEF',
  statusAssignedBg: '#EFF6FF',

  // Status — On The Way (Orange)
  statusOnTheWay: '#D97706',
  statusOnTheWayBg: '#FFFBEB',

  // Status — In Progress (Green)
  statusInProgress: '#16A34A',
  statusInProgressBg: '#F0FDF4',

  // Status — Completed (Gray)
  statusCompleted: '#6B7280',
  statusCompletedBg: '#F9FAFB',

  // Tab
  tabActiveBg: '#111111',
  tabActiveFg: '#FFFFFF',
  tabInactiveBg: '#FFFFFF',
  tabInactiveFg: '#111111',
  tabBorder: '#E4E4E4',

  // Open Job button
  openJobBg: '#111111',
  openJobFg: '#FFFFFF',

  // Appliance icon bg
  iconBg: '#EFF6FF',
  iconColor: '#208AEF',

  shadowColor: '#000000',
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const AJSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 16,
  xxl: 32,
  section: 20,
} as const;

// ─── Radius ───────────────────────────────────────────────────────────────────

export const AJRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

// ─── Shadows ──────────────────────────────────────────────────────────────────

export const AJShadow = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardMd: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
} as const;

// ─── Status Tabs ──────────────────────────────────────────────────────────────

export const STATUS_TABS: StatusTab[] = [
  { id: 'active',    label: 'Active Jobs'    },
  { id: 'completed', label: 'Completed Jobs' },
];

// ─── Status Config ────────────────────────────────────────────────────────────

// Note: We keep the detailed statuses here so the Job Card badge can still render them properly
export const STATUS_CONFIG: Record<JobStatus | string, { label: string; color: string; bg: string }> = {
  active:      { label: 'Active Jobs', color: AJColors.ink,              bg: AJColors.borderLight        },
  completed:   { label: 'Completed',   color: AJColors.statusCompleted,  bg: AJColors.statusCompletedBg  },
  
  // Detailed badge states for the job cards
  assigned:    { label: 'Assigned',    color: AJColors.statusAssigned,   bg: AJColors.statusAssignedBg   },
  on_the_way:  { label: 'On The Way',  color: AJColors.statusOnTheWay,   bg: AJColors.statusOnTheWayBg   },
  in_progress: { label: 'In Progress', color: AJColors.statusInProgress, bg: AJColors.statusInProgressBg },
};

// ─── Appliance Icon Map ───────────────────────────────────────────────────────

export const APPLIANCE_ICON: Record<string, string> = {
  'AC':              'ac-unit',
  'AC Repair':       'ac-unit',
  'Washing Machine': 'local-laundry-service',
  'Refrigerator':    'kitchen',
  'Microwave':       'microwave',
  'Electrician':     'electrical-services',
  'Plumbing':        'plumbing',
  'Geyser Repair':   'water-damage',
  'Water Purifier':  'water-drop',
  'RO System':       'water-drop',
};

// ─── Empty State Config ───────────────────────────────────────────────────────

export const EMPTY_STATE_CONFIG: Record<string, { icon: string; title: string; subtitle: string }> = {
  active:      { icon: 'work-outline',       title: 'No Active Jobs',           subtitle: "You don't have any active jobs right now."              },
  completed:   { icon: 'check-circle',       title: 'No Jobs Completed',        subtitle: "Jobs you complete will appear here."                    },
  assigned:    { icon: 'assignment-ind',     title: 'No Assigned Jobs',         subtitle: "Jobs assigned to you will appear here."                 },
  on_the_way:  { icon: 'directions-bike',    title: 'No Jobs On The Way',       subtitle: "Jobs you are traveling to will appear here."            },
  in_progress: { icon: 'build',              title: 'No Jobs In Progress',      subtitle: "Jobs currently in progress will appear here."           },
  all:         { icon: 'work-outline',       title: 'No Jobs Found',            subtitle: "No service jobs found."                                 },
};
`;

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully fixed ActiveJobs constants/index.ts');
