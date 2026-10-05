import { StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, type } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { ScenesScreen } from '../screens/ScenesScreen';
import { AutomationsScreen } from '../screens/AutomationsScreen';
import { EnergyScreen } from '../screens/EnergyScreen';
import { AiScreen } from '../screens/AiScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Tabs: undefined;
};

export type TabParamList = {
  Home: undefined;
  Devices: undefined;
  Scenes: undefined;
  Automations: undefined;
  Energy: undefined;
  Assistant: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: 'rgba(7,10,20,0.94)',
    text: colors.text,
    border: colors.borderSoft,
    notification: colors.red,
  },
};

const TAB_META: Record<keyof TabParamList, { glyph: string; label: string }> = {
  Home: { glyph: '⌂', label: 'Home' },
  Devices: { glyph: '⏻', label: 'Devices' },
  Scenes: { glyph: '✦', label: 'Scenes' },
  Automations: { glyph: '⚡', label: 'Rules' },
  Energy: { glyph: '📈', label: 'Energy' },
  Assistant: { glyph: '✳', label: 'Ask' },
  Settings: { glyph: '⚙', label: 'Settings' },
};

function TabIcon({ name, focused }: { name: keyof TabParamList; focused: boolean }) {
  const meta = TAB_META[name];
  return (
    <View style={styles.tabIconWrap}>
      {focused ? <View style={styles.tabIconGlow} /> : null}
      <Text style={[styles.tabGlyph, focused && styles.tabGlyphActive]}>{meta.glyph}</Text>
    </View>
  );
}

function Tabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primarySoft,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: [styles.tabBar, { height: 62 + insets.bottom, paddingBottom: insets.bottom + 6 }],
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused }) => <TabIcon name={route.name as keyof TabParamList} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Devices" component={DevicesScreen} />
      <Tab.Screen name="Scenes" component={ScenesScreen} />
      <Tab.Screen name="Automations" component={AutomationsScreen} />
      <Tab.Screen name="Energy" component={EnergyScreen} />
      <Tab.Screen name="Assistant" component={AiScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="Tabs" component={Tabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    backgroundColor: 'rgba(7,10,20,0.96)',
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
  },
  tabLabel: { ...type.tiny, fontSize: 9, marginTop: -2 },
  tabIconWrap: { width: 34, height: 26, alignItems: 'center', justifyContent: 'center' },
  tabIconGlow: {
    position: 'absolute',
    top: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(91,141,239,0.22)',
  },
  tabGlyph: { fontSize: 15, color: colors.textFaint },
  tabGlyphActive: { color: colors.primarySoft },
});