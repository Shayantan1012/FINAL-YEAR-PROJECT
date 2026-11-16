import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { LocalizedText as Text } from "../i18n/I18n";
import { api, ApiProduct, ApiUser } from "../services/api";
import { ProductForm } from "./ProductForm";
import { ProductPhoto } from "../components/ProductPhoto";
import { Button } from "../components/Button";
import { Feedback } from "../components/Feedback";
import { ApprovalStatusBadge } from "../components/ApprovalStatusBadge";
import { s } from "../styles/appStyles";
export function FarmerProductsScreen({
  user,
  onRefreshAccount,
  onChanged,
}: {
  user: ApiUser;
  onRefreshAccount: () => Promise<ApiUser>;
  onChanged: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState<ApiProduct[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<ApiProduct | null | undefined>(undefined),
    [deleting, setDeleting] = useState(""),
    [busy, setBusy] = useState(false),
    [statusMessage, setStatusMessage] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.mine(page);
      setItems(r.products);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (user.approved) void load();
  }, [page, user.approved]);
  const checkApproval = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatusMessage("");
    try {
      const latest = await onRefreshAccount();
      if (!latest.approved)
        setStatusMessage(
          "Status checked. Your farm is still awaiting administrator approval.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setDeleting("");
      onChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!user.approved)
    return (
      <View style={s.panel}>
        <ApprovalStatusBadge approved={false} />
        <Text style={s.heading}>Your farm is awaiting approval</Text>
        <Text style={s.body}>
          Your account is verified. An administrator needs to approve your farm
          before you can publish products.
        </Text>
        <Feedback error={error} />
        {!!statusMessage && (
          <Text accessibilityLiveRegion="polite" style={s.body}>
            {statusMessage}
          </Text>
        )}
        <Button
          label={busy ? "Checking approval..." : "Check approval status"}
          disabled={busy}
          onPress={() => void checkApproval()}
        />
      </View>
    );
  if (editing !== undefined)
    return (
      <ProductForm
        product={editing || undefined}
        onCancel={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          onChanged();
          void load();
        }}
      />
    );
  return (
    <View style={{ gap: 16 }}>
      <View style={s.between}>
        <View style={{ gap: 8 }}>
          <Text style={s.heading}>My products</Text>
          <Text style={s.muted}>{user.farmName}</Text>
          <ApprovalStatusBadge approved />
        </View>
        <Button label="Add product" onPress={() => setEditing(null)} />
      </View>
      <Button
        secondary
        label="Refresh products"
        disabled={busy}
        onPress={load}
      />
      <Feedback
        loading={loading}
        error={error}
        onRetry={load}
        empty={
          !items.length ? "You have not added any products yet." : undefined
        }
      />
      {!loading &&
        !error &&
        items.map((p) => (
          <View key={p.id} style={s.panel}>
            <ProductPhoto image={p.image} style={{ borderRadius: 12 }} />
            <Text style={s.cardTitle}>{p.name}</Text>
            <Text style={s.body}>
              ₹{p.price} / kg · {p.stock} kg available
            </Text>
            <Text style={s.badge}>
              {!p.active
                ? "Paused"
                : p.stock === 0
                  ? "Out of stock"
                  : p.expiry && p.expiry < today
                    ? `Expired on ${p.expiry} — edit or remove the expiry date`
                    : "Active on marketplace"}
            </Text>
            {deleting === p.id ? (
              <>
                <Text style={s.body}>
                  Remove this product from the marketplace? Previous orders will
                  retain their receipts.
                </Text>
                <Button
                  label="Confirm delete"
                  disabled={busy}
                  onPress={() => change(() => api.deleteProduct(p.id))}
                />
                <Button
                  label="Keep product"
                  secondary
                  disabled={busy}
                  onPress={() => setDeleting("")}
                />
              </>
            ) : (
              <View style={s.wrap}>
                <Button
                  label="Edit product"
                  secondary
                  disabled={busy}
                  onPress={() => setEditing(p)}
                />
                <Button
                  label={p.active ? "Pause" : "Reactivate"}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    change(() => api.pauseProduct(p.id, !p.active))
                  }
                />
                <Button
                  label="Delete product"
                  secondary
                  disabled={busy}
                  onPress={() => setDeleting(p.id)}
                />
              </View>
            )}
          </View>
        ))}
      <View style={s.wrap}>
        {page > 1 && (
          <Button
            label="Previous"
            secondary
            onPress={() => setPage((p) => p - 1)}
          />
        )}
        <Text style={s.muted}>
          Page {page} · {total} products
        </Text>
        {page * 20 < total && (
          <Button
            label="Next"
            secondary
            onPress={() => setPage((p) => p + 1)}
          />
        )}
      </View>
    </View>
  );
}
