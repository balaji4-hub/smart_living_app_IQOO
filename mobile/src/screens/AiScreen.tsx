import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApp } from '../api/store';
import { colors, radius, space, type } from '../theme';
import { Card, Pill, Row, tap } from '../components/ui';

const QUICK_PROMPTS = [
  'Turn on the living room lights',
  'Set the heating to 21°',
  'Lock up for the night',
  'Who is using the most energy?',
  'Make it movie night',
  'Is the air healthy?',
];

export function AiScreen() {
  const insets = useSafeAreaInsets();
  const chat = useApp((s) => s.chat);
  const suggestions = useApp((s) => s.suggestions);
  const sendChat = useApp((s) => s.sendChat);
  const refreshChat = useApp((s) => s.refreshChat);

  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    void refreshChat();
  }, [refreshChat]);

  const prompts = suggestions.length ? suggestions : QUICK_PROMPTS;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setDraft('');
    setThinking(true);
    await sendChat(trimmed);
    setThinking(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 60}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Row style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Assistant</Text>
            <Text style={styles.subtitle}>Runs locally on your simulator</Text>
          </View>
          <Pill label="No API key" color={colors.teal} />
        </Row>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {chat.length === 0 ? (
          <Card>
            <Text style={styles.intro}>
              Ask about your home and I will read the live simulation: devices, rooms, energy, automations and presence. I can also
              run commands and build automations for you.
            </Text>
          </Card>
        ) : null}

        {chat.map((message, index) => (
          <View key={message.id ?? `${index}`} style={[styles.bubbleRow, message.role === 'user' && styles.bubbleRowUser]}>
            <View style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
              <Text style={[styles.bubbleText, message.role === 'user' && styles.bubbleTextUser]}>{message.content}</Text>
            </View>
          </View>
        ))}

        {thinking ? (
          <View style={styles.bubbleRow}>
            <View style={[styles.bubble, styles.bubbleBot]}>
              <ActivityIndicator size="small" color={colors.primarySoft} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.promptRow}
        keyboardShouldPersistTaps="handled"
      >
        {prompts.map((prompt) => (
          <Pressable
            key={prompt}
            onPress={() => {
              tap();
              void send(prompt);
            }}
            style={styles.prompt}
          >
            <Text style={styles.promptText}>{prompt}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void send(draft)}
          placeholder="Ask about your home…"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !draft.trim() || thinking }}
          style={[styles.sendBtn, (!draft.trim() || thinking) && styles.sendBtnDisabled]}
          onPress={() => void send(draft)}
          disabled={!draft.trim() || thinking}
        >
          <Text style={styles.sendGlyph}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  headerRow: { justifyContent: 'space-between' },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.small, color: colors.textFaint, marginTop: 2 },
  messages: { padding: space.lg, gap: space.sm, paddingBottom: space.md },
  intro: { ...type.small, color: colors.textDim, lineHeight: 20 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', padding: space.md, borderRadius: radius.lg },
  bubbleBot: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  bubbleText: { ...type.body, color: colors.text, lineHeight: 20 },
  bubbleTextUser: { color: colors.bg },
  promptRow: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  prompt: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  promptText: { ...type.tiny, color: colors.textDim },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
    backgroundColor: 'rgba(7,10,20,0.95)',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    color: colors.text,
    ...type.body,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendGlyph: { color: colors.bg, fontSize: 18, fontWeight: '700' },
});