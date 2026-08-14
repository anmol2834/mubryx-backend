const fs = require('fs');
const path = require('path');

const root = 'C:/technician-dashboard';

// 1. NearbyLeads/types/index.ts
const nearbyTypesPath = path.join(root, 'src/screens/NearbyLeads/types/index.ts');
const nearbyTypesContent = `// ─── Filter ───────────────────────────────────────────────────────────────────

export type FilterId =
  | 'nearest'
  | 'highest_price'
  | 'ac'
  | 'washing_machine'
  | 'refrigerator'
  | 'microwave'
  | 'electrician'
  | 'plumbing';

export interface Filter {
  id: FilterId;
  label: string;
}

// ─── Appliance Category ───────────────────────────────────────────────────────

export type ApplianceCategory =
  | 'AC'
  | 'AC Repair'
  | 'Washing Machine'
  | 'Refrigerator'
  | 'Microwave'
  | 'Electrician'
  | 'Plumbing'
  | 'Geyser Repair'
  | 'Water Purifier'
  | 'RO System';

// ─── Lead ─────────────────────────────────────────────────────────────────────

export interface NearbyLead {
  id?: string;
  bookingId: string;
  bookingItemId?: string;
  applianceName: ApplianceCategory | string;
  serviceName: string;
  issueDescription: string;
  customerName: string;
  customerRating?: number;
  address: string;
  distanceKm: number;
  etaMinutes: number;
  serviceCharge: number;
  estimatedDurationMinutes: number;
  bookedMinutesAgo: number;
}
`;
fs.writeFileSync(nearbyTypesPath, nearbyTypesContent, 'utf8');
console.log('Updated', nearbyTypesPath);

// 2. NearbyLeads/constants/index.ts
const nearbyConstantsPath = path.join(root, 'src/screens/NearbyLeads/constants/index.ts');
let nearbyConstantsContent = fs.readFileSync(nearbyConstantsPath, 'utf8');
const updatedApplianceIcon = `export const APPLIANCE_ICON: Record<string, React.ComponentProps<any>['name']> = {
  'AC': 'ac-unit',
  'AC Repair': 'ac-unit',
  'Washing Machine': 'local-laundry-service',
  'Refrigerator': 'kitchen',
  'Microwave': 'microwave',
  'Electrician': 'electrical-services',
  'Plumbing': 'plumbing',
  'Geyser Repair': 'water-damage',
  'Water Purifier': 'water-drop',
  'RO System': 'water-drop',
} as const;`;
nearbyConstantsContent = nearbyConstantsContent.replace(/export const APPLIANCE_ICON[\s\S]*?} as const;/, updatedApplianceIcon);
fs.writeFileSync(nearbyConstantsPath, nearbyConstantsContent, 'utf8');
console.log('Updated', nearbyConstantsPath);

// 3. NearbyLeads/hooks/useNearbyLeads.ts
const nearbyHookPath = path.join(root, 'src/screens/NearbyLeads/hooks/useNearbyLeads.ts');
const nearbyHookContent = `import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FilterId, NearbyLead } from '../types';

const CATEGORY_FILTER_MAP: Partial<Record<FilterId, string>> = {
  ac: 'AC',
  washing_machine: 'Washing Machine',
  refrigerator: 'Refrigerator',
  microwave: 'Microwave',
  electrician: 'Electrician',
  plumbing: 'Plumbing',
};

interface UseNearbyLeadsReturn {
  leads: NearbyLead[];
  activeFilter: FilterId;
  isLoading: boolean;
  isRefreshing: boolean;
  setFilter: (id: FilterId) => void;
  dismissLead: (bookingId: string) => void;
  refresh: () => Promise<void>;
}

function mapDispatchToLead(dispatch: any, index: number): NearbyLead {
  const booking = dispatch.booking || {};
  const customer = booking.customer || {};
  const item = (booking.items && booking.items[0]) || dispatch.bookingItem || {};

  const createdTime = new Date(booking.createdAt || dispatch.createdAt || Date.now()).getTime();
  const minutesAgo = Math.max(0, Math.floor((Date.now() - createdTime) / 60000));

  let resolvedAddress = 'Address not provided';
  if (booking.snapshotAddress) {
    resolvedAddress = booking.snapshotCity
      ? \`\${booking.snapshotAddress}, \${booking.snapshotCity}\`
      : booking.snapshotAddress;
  } else if (booking.address?.completeAddress) {
    resolvedAddress = booking.address.completeAddress;
  } else if (booking.address?.formattedAddress) {
    resolvedAddress = booking.address.formattedAddress;
  } else if (typeof booking.address === 'string' && booking.address.trim()) {
    resolvedAddress = booking.address;
  }

  const uniqueId = dispatch.id || (dispatch.bookingItemId ? \`\${dispatch.bookingId}-\${dispatch.bookingItemId}\` : dispatch.bookingId) || \`lead-\${index}\`;

  return {
    id: String(uniqueId),
    bookingId: String(dispatch.bookingId || booking.id || booking.bookingNumber || ''),
    bookingItemId: String(dispatch.bookingItemId || item.id || ''),
    applianceName: (item.categoryNameSnapshot || item.category || 'Service') as any,
    serviceName: String(item.serviceTitleSnapshot || item.title || item.name || dispatch.bookingItem?.service?.title || 'Service Request'),
    issueDescription: String(item.description || booking.customerNotes || 'Standard service request'),
    customerName: String(customer.name || 'Customer'),
    customerRating: 4.8,
    distanceKm: Number(dispatch.distanceKm || 0),
    etaMinutes: Math.max(5, Math.round(Number(dispatch.distanceKm || 0) * 3) + 15),
    serviceCharge: Number(booking.totalAmount || booking.serviceCharge || item.unitPrice || 0),
    estimatedDurationMinutes: 60,
    bookedMinutesAgo: minutesAgo,
    address: resolvedAddress,
  };
}

export function useNearbyLeads(): UseNearbyLeadsReturn {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterId>('nearest');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: rawLeads, isLoading, refetch } = useQuery({
    queryKey: ['nearbyLeads'],
    queryFn: async () => {
      try {
        const { data } = await apiClient.get('/technicians/nearby-leads');
        if (Array.isArray(data)) {
          return data.map((d, i) => mapDispatchToLead(d, i)) as NearbyLead[];
        }
        if (data && Array.isArray(data.leads)) {
          return data.leads.map((d: any, i: number) => mapDispatchToLead(d, i)) as NearbyLead[];
        }
        return [];
      } catch (error) {
        return [];
      }
    },
    staleTime: 5000,
    refetchInterval: 5000,
    retry: 2,
  });

  const dismissLead = useCallback((bookingId: string) => {
    setDismissed((prev) => new Set(prev).add(bookingId));
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setDismissed(new Set());
    queryClient.invalidateQueries({ queryKey: ['nearbyLeads'] });
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, refetch]);

  const setFilter = useCallback((id: FilterId) => {
    setActiveFilter(id);
  }, []);

  const leads = useMemo(() => {
    const list = Array.isArray(rawLeads) ? rawLeads : [];
    let result = list.filter((l) => l && l.bookingId && !dismissed.has(l.bookingId));

    const categoryTarget = CATEGORY_FILTER_MAP[activeFilter];
    if (categoryTarget) {
      result = result.filter((l) => l.applianceName === categoryTarget);
    } else if (activeFilter === 'nearest') {
      result = [...result].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    } else if (activeFilter === 'highest_price') {
      result = [...result].sort((a, b) => (b.serviceCharge ?? 0) - (a.serviceCharge ?? 0));
    }

    return result;
  }, [rawLeads, activeFilter, dismissed]);

  return { leads, activeFilter, isLoading, isRefreshing, setFilter, dismissLead, refresh };
}
`;
fs.writeFileSync(nearbyHookPath, nearbyHookContent, 'utf8');
console.log('Updated', nearbyHookPath);

// 4. NearbyLeads/index.tsx
const nearbyIndexPath = path.join(root, 'src/screens/NearbyLeads/index.tsx');
const nearbyIndexContent = `import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useState } from 'react';
import { FlatList, ListRenderItemInfo, RefreshControl, ScrollView, StyleSheet, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

import { NLColors, NLSpacing } from './constants';
import { useNearbyLeads } from './hooks/useNearbyLeads';
import { NearbyLead } from './types';

import { FilterChipList } from './components/FilterChipList';
import { LeadCard } from './components/LeadCard';
import { LeadEmptyState } from './components/LeadEmptyState';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { NearbyHeader } from './components/NearbyHeader';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NearbyLeadsScreen() {
  const { leads, activeFilter, isLoading, isRefreshing, setFilter, refresh } = useNearbyLeads();

  const [isAcceptingId, setIsAcceptingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleAccept = useCallback(async (bookingId: string) => {
    try {
      setIsAcceptingId(bookingId);
      await apiClient.post(\`/bookings/\${bookingId}/accept\`);
      
      // Remove from leads
      queryClient.invalidateQueries({ queryKey: ['nearbyLeads'] });
      queryClient.invalidateQueries({ queryKey: ['technicianNotifications'] });
      queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      
      Alert.alert('Success', 'Booking accepted successfully!');
      router.push(\`/job-details/\${bookingId}\`);
    } catch (error: any) {
      if (error.response?.status === 409) {
        Alert.alert(
          'Booking Unavailable',
          'This service request has already been assigned or is no longer available.',
          [{ text: 'OK' }]
        );
        queryClient.invalidateQueries({ queryKey: ['nearbyLeads'] });
        queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      } else if (error.response?.status === 400) {
        const errorData = error.response.data;
        const requiredAmount = errorData?.requiredAmount;
        const messageText = requiredAmount 
          ? \`Insufficient wallet balance. You need at least ₹\${requiredAmount} to accept this job. Please recharge to continue.\`
          : 'Insufficient wallet balance to accept this job. Please recharge to continue.';
          
        Alert.alert(
          'Action Required',
          messageText,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Recharge Now', 
              onPress: () => {
                if (requiredAmount) {
                  router.push(\`/wallet-recharge?suggestedAmount=\${requiredAmount}\` as any);
                } else {
                  router.push('/wallet-recharge' as any);
                }
              }
            }
          ]
        );
      } else {
        console.error('Failed to accept booking:', error);
        Alert.alert('Error', 'Failed to accept the booking. Please try again.');
      }
    } finally {
      setIsAcceptingId(null);
    }
  }, [queryClient]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<NearbyLead>) => (
      <LeadCard
        lead={item}
        onAccept={handleAccept}
        isAccepting={isAcceptingId === item.bookingId}
      />
    ),
    [handleAccept, isAcceptingId]
  );

  const keyExtractor = useCallback(
    (item: NearbyLead, index: number) => item.id || \`\${item.bookingId}-\${item.bookingItemId || index}\`,
    []
  );

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={['top']}>

        {/* Fixed Header */}
        <NearbyHeader onRefresh={refresh} />

        {/* Filter Chips */}
        <FilterChipList
          activeFilter={activeFilter}
          onFilterChange={setFilter}
        />

        {/* Lead List, Skeleton, or Empty State */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : leads.length === 0 ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={refresh}
                colors={['#208AEF']}
                tintColor="#208AEF"
              />
            }
          >
            <LeadEmptyState onRefresh={refresh} />
          </ScrollView>
        ) : (
          <FlatList
            data={leads}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={<View style={styles.listHeader} />}
            ListFooterComponent={<View style={styles.listFooter} />}
            ItemSeparatorComponent={<View style={styles.separator} />}
            maxToRenderPerBatch={8}
            windowSize={10}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={refresh}
                colors={['#208AEF']}
                tintColor="#208AEF"
              />
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: NLColors.surface,
  },
  safeArea: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  listHeader: {
    height: NLSpacing.base,
  },
  listFooter: {
    height: NLSpacing.xxl,
  },
  separator: {
    height: NLSpacing.md,
  },
});
`;
fs.writeFileSync(nearbyIndexPath, nearbyIndexContent, 'utf8');
console.log('Updated', nearbyIndexPath);

// 5. ActiveJobs/constants/index.ts
const activeConstantsPath = path.join(root, 'src/screens/ActiveJobs/constants/index.ts');
let activeConstantsContent = fs.readFileSync(activeConstantsPath, 'utf8');
const updatedActiveApplianceIcon = `export const APPLIANCE_ICON: Record<string, string> = {
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
};`;

activeConstantsContent = activeConstantsContent.replace(/export const APPLIANCE_ICON[\s\S]*?};/, updatedActiveApplianceIcon);
fs.writeFileSync(activeConstantsPath, activeConstantsContent, 'utf8');
console.log('Updated', activeConstantsPath);

// 6. ActiveJobs/components/EmptyJobsState/index.tsx
const emptyJobsStatePath = path.join(root, 'src/screens/ActiveJobs/components/EmptyJobsState/index.tsx');
const emptyJobsStateContent = `import { MaterialIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AJColors, AJRadius, AJSpacing, EMPTY_STATE_CONFIG } from '../../constants';
import { JobStatus } from '../../types';

interface EmptyJobsStateProps {
  status: JobStatus | string;
}

export const EmptyJobsState = memo(function EmptyJobsState({ status }: EmptyJobsStateProps) {
  const config =
    EMPTY_STATE_CONFIG[status] ||
    EMPTY_STATE_CONFIG.active || {
      icon: 'work-outline',
      title: 'No Jobs Found',
      subtitle: 'No jobs available in this section.',
    };

  return (
    <View style={styles.container}>
      <View style={styles.iconBox}>
        <MaterialIcons name={(config.icon || 'work-outline') as any} size={34} color={AJColors.textMuted} />
      </View>
      <Text style={styles.title}>{config.title}</Text>
      <Text style={styles.subtitle}>{config.subtitle}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: AJSpacing.xxl,
    gap: AJSpacing.md,
    paddingBottom: 60,
  },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: AJRadius.full,
    backgroundColor: AJColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AJColors.border,
    marginBottom: AJSpacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: AJColors.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
    color: AJColors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 280,
  },
});
`;
fs.writeFileSync(emptyJobsStatePath, emptyJobsStateContent, 'utf8');
console.log('Updated', emptyJobsStatePath);

// 7. ActiveJobs/components/JobCustomerInfo/index.tsx
const jobCustomerInfoPath = path.join(root, 'src/screens/ActiveJobs/components/JobCustomerInfo/index.tsx');
const jobCustomerInfoContent = `import { MaterialIcons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AJColors, AJRadius, AJSpacing } from '../../constants';

interface JobCustomerInfoProps {
  customerName: string;
  address: string;
}

export const JobCustomerInfo = memo(function JobCustomerInfo({
  customerName,
  address,
}: JobCustomerInfoProps) {
  const safeName = typeof customerName === 'string' && customerName.trim() ? customerName : 'Customer';
  const safeAddress = typeof address === 'string' && address.trim() ? address : 'Address not specified';

  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{safeName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.customerName}>{safeName}</Text>
        <View style={styles.addressRow}>
          <MaterialIcons name="location-on" size={12} color={AJColors.textMuted} />
          <Text style={styles.address} numberOfLines={1}>{safeAddress}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AJSpacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: AJRadius.full,
    backgroundColor: AJColors.statusAssignedBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: AJColors.statusAssigned,
  },
  textBlock: {
    flex: 1,
    gap: 3,
  },
  customerName: {
    fontSize: 14,
    fontWeight: '600',
    color: AJColors.ink,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  address: {
    flex: 1,
    fontSize: 12,
    fontWeight: '400',
    color: AJColors.textMuted,
  },
});
`;
fs.writeFileSync(jobCustomerInfoPath, jobCustomerInfoContent, 'utf8');
console.log('Updated', jobCustomerInfoPath);

// 8. ActiveJobs/hooks/useActiveJobs.ts
const activeHookPath = path.join(root, 'src/screens/ActiveJobs/hooks/useActiveJobs.ts');
const activeHookContent = `import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ActiveJob, JobStatus } from '../types';

interface UseActiveJobsReturn {
  activeTab: JobStatus | string;
  setTab: (tab: JobStatus | string) => void;
  jobs: ActiveJob[];
  isLoading: boolean;
  refresh: () => void;
}

export function useActiveJobs(): UseActiveJobsReturn {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<JobStatus | string>('active');

  const { data: rawJobs, isLoading, refetch } = useQuery({
    queryKey: ['activeJobs', activeTab],
    queryFn: async () => {
      try {
        const res = await apiClient.get(\`/technicians/bookings?tab=\${activeTab}\`);
        const list = Array.isArray(res.data) ? res.data : [];
        
        return list.map((item: any, index: number): ActiveJob => {
          const statusStr = item.status || 'TECHNICIAN_ASSIGNED';
          
          let resolvedAddress = 'Address not specified';
          if (item.address?.completeAddress) {
            resolvedAddress = item.address.completeAddress;
          } else if (item.snapshotAddress) {
            resolvedAddress = item.snapshotCity ? \`\${item.snapshotAddress}, \${item.snapshotCity}\` : item.snapshotAddress;
          } else if (typeof item.address === 'string' && item.address.trim()) {
            resolvedAddress = item.address;
          }

          const firstItem = item.items?.[0] || {};

          return {
            bookingId: String(item.id || item.bookingId || \`job-\${index}\`),
            applianceName: (firstItem.categoryNameSnapshot || item.category || 'Service') as any,
            serviceName: String(firstItem.serviceTitleSnapshot || item.serviceName || 'Service Request'),
            customerName: String(item.customer?.name || item.customerName || 'Customer'),
            address: resolvedAddress,
            distanceKm: Number(item.distanceKm || 2.5),
            etaMinutes: Number(item.etaMinutes || 15),
            estimatedDurationMinutes: parseInt(firstItem.durationSnapshot || '60', 10) || 60,
            bookingTime: item.scheduledAt ? new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today',
            status: mapBackendStatusToFrontend(statusStr),
            serviceCharge: Number(item.subtotal ?? item.totalAmount ?? 0),
          };
        });
      } catch (error) {
        console.error('Failed to fetch active jobs:', error);
        return [];
      }
    },
    staleTime: 10000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const setTab = useCallback((tab: JobStatus | string) => {
    setActiveTab(tab);
  }, []);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
    refetch();
  }, [queryClient, refetch]);

  const jobs = useMemo(() => {
    return Array.isArray(rawJobs) ? rawJobs : [];
  }, [rawJobs]);

  return { activeTab, setTab, jobs, isLoading, refresh };
}

function mapBackendStatusToFrontend(status: string): JobStatus {
  switch (status) {
    case 'TECHNICIAN_ASSIGNED':
    case 'TECHNICIAN_ACCEPTED':
      return 'assigned';
    case 'TECHNICIAN_ON_THE_WAY':
      return 'on_the_way';
    case 'TECHNICIAN_ARRIVED':
    case 'SERVICE_STARTED':
    case 'PAYMENT_PENDING':
      return 'in_progress';
    case 'SERVICE_COMPLETED':
    case 'COMPLETED':
      return 'completed';
    default:
      return 'assigned';
  }
}
`;
fs.writeFileSync(activeHookPath, activeHookContent, 'utf8');
console.log('Updated', activeHookPath);

// 9. ActiveJobs/index.tsx
const activeIndexPath = path.join(root, 'src/screens/ActiveJobs/index.tsx');
const activeIndexContent = `import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useState } from 'react';
import { FlatList, ListRenderItemInfo, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AJColors, AJSpacing } from './constants';
import { useActiveJobs } from './hooks/useActiveJobs';
import { ActiveJob } from './types';

import { ActiveJobsHeader } from './components/ActiveJobsHeader';
import { EmptyJobsState } from './components/EmptyJobsState';
import { JobCard } from './components/JobCard';
import { JobStatusTabs } from './components/JobStatusTabs';
import { LoadingSkeleton } from './components/LoadingSkeleton';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActiveJobsScreen() {
  const { activeTab, setTab, jobs, isLoading, refresh } = useActiveJobs();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Refetch data every time this screen comes into focus
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleOpenJob = useCallback((bookingId: string) => {
    router.push(\`/job-details/\${bookingId}\`);
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ActiveJob>) => (
      <JobCard job={item} onOpenJob={handleOpenJob} />
    ),
    [handleOpenJob]
  );

  const keyExtractor = useCallback(
    (item: ActiveJob, index: number) => item.bookingId ? \`\${item.bookingId}-\${index}\` : String(index),
    []
  );

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={['top']}>

        {/* Fixed Header */}
        <ActiveJobsHeader onRefresh={refresh} />

        {/* Status Tabs */}
        <JobStatusTabs activeTab={activeTab} onTabChange={setTab} />

        {/* Job List, Skeleton, or Empty State */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : jobs.length === 0 ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={['#208AEF']}
                tintColor="#208AEF"
              />
            }>
            <EmptyJobsState status={activeTab} />
          </ScrollView>
        ) : (
          <FlatList
            data={jobs}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={<View style={styles.listHeader} />}
            ListFooterComponent={<View style={styles.listFooter} />}
            ItemSeparatorComponent={<View style={styles.separator} />}
            maxToRenderPerBatch={8}
            windowSize={10}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={['#208AEF']}
                tintColor="#208AEF"
              />
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: AJColors.surface,
  },
  safeArea: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  listHeader: {
    height: AJSpacing.base,
  },
  listFooter: {
    height: AJSpacing.xxl,
  },
  separator: {
    height: AJSpacing.md,
  },
});
`;
fs.writeFileSync(activeIndexPath, activeIndexContent, 'utf8');
console.log('Updated', activeIndexPath);
