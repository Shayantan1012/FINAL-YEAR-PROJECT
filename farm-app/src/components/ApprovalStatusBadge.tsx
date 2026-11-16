import React from "react";
import { StyleSheet, View } from "react-native";
import { LocalizedText as Text, useI18n } from "../i18n/I18n";
import { greenDark, mint, sage } from "../theme/colors";
import { Icon } from "./Icon";

export function ApprovalStatusBadge({ approved }: { approved: boolean }) {
  const { t } = useI18n();
  const label = approved ? "Approved" : "Awaiting approval";
  const color = approved ? greenDark : "#795312";

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={t(label)}
      style={[styles.badge, approved ? styles.approved : styles.pending]}
    >
      <Icon
        name={approved ? "checkmark-circle" : "time-outline"}
        size={21}
        color={color}
      />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  approved: { backgroundColor: mint, borderColor: sage },
  pending: { backgroundColor: "#FFF5DC", borderColor: "#E8D09A" },
  label: { fontSize: 13, fontWeight: "700" },
});
