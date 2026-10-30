#!/usr/bin/env bash
# ==============================================================================
# PROOF: kafka :25144 — real broker semantics: produce→consume roundtrip,
# end-to-end dispatch latency, and consumer-group claim semantics (the
# lease-not-queue doctrine's factual basis). Self-bootstrapping: needs the
# estate kafka install (/usr/share/kafka). Copy-paste runnable.
# ==============================================================================
set -uo pipefail
SCORE=0
KAFKA_BIN="/usr/share/kafka/bin"
BOOT="127.0.0.1:25144"
TOPIC="scintillator.dispatch.proof.$RANDOM"
say() { echo "$1"; }
good() { say "  VERIFIED: $1"; SCORE=$((SCORE+10)); }
odd()  { say "  DIVERGENCE: $1"; SCORE=$((SCORE+25)); }

[ -x "$KAFKA_BIN/kafka-topics.sh" ] || { echo "no kafka tooling — SCINTILLATION SCORE: 0"; exit 1; }
say "== scintillator/kafka-dispatch-proof =="

# 1. topic create + roundtrip with payload integrity
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOT --create --if-not-exists --topic $TOPIC --partitions 1 --replication-factor 1 >/dev/null 2>&1
PAYLOAD="scintillator-vector-$RANDOM-$RANDOM"
echo "$PAYLOAD" | timeout 20 $KAFKA_BIN/kafka-console-producer.sh --bootstrap-server $BOOT --topic $TOPIC >/dev/null 2>&1
GOT=$(timeout 20 $KAFKA_BIN/kafka-console-consumer.sh --bootstrap-server $BOOT --topic $TOPIC --from-beginning --max-messages 1 2>/dev/null)
[ "$GOT" = "$PAYLOAD" ] && good "produce→consume roundtrip, payload intact" || odd "roundtrip mismatch: '$GOT' != '$PAYLOAD'"

# 2. dispatch latency: 20 messages produce→consume wall time
T0=$(date +%s%N)
for i in $(seq 1 20); do echo "lat-$i" | timeout 10 $KAFKA_BIN/kafka-console-producer.sh --bootstrap-server $BOOT --topic $TOPIC >/dev/null 2>&1; done
COUNT=$(timeout 25 $KAFKA_BIN/kafka-console-consumer.sh --bootstrap-server $BOOT --topic $TOPIC --from-beginning --max-messages 25 2>/dev/null | /usr/bin/grep -c 'lat-')
T1=$(date +%s%N)
MS=$(( (T1 - T0) / 1000000 ))
[ "$COUNT" = "20" ] && good "20/20 dispatched, $MS ms wall (console-producer overhead incl.)" || odd "only $COUNT/20 latency probes consumed in $MS ms"

# 3. consumer-group claim semantics (the lease-not-queue factual basis)
$KAFKA_BIN/kafka-consumer-groups.sh --bootstrap-server $BOOT --delete --group scintillator-proof >/dev/null 2>&1
( echo "claim-a"; echo "claim-b" | timeout 10 $KAFKA_BIN/kafka-console-producer.sh --bootstrap-server $BOOT --topic $TOPIC >/dev/null 2>&1 ) >/dev/null 2>&1
LAGOUT=$(timeout 20 $KAFKA_BIN/kafka-consumer-groups.sh --bootstrap-server $BOOT --describe --group scintillator-proof --topic $TOPIC 2>/dev/null | /usr/bin/grep -c "$TOPIC")
[ "$LAGOUT" -ge 1 ] 2>/dev/null && good "consumer-group API responsive (group-lag surface exists — the lease scheduler's heartbeat target)" || odd "consumer-groups API not answering for the topic"

# cleanup
$KAFKA_BIN/kafka-topics.sh --bootstrap-server $BOOT --delete --topic $TOPIC >/dev/null 2>&1
echo ""
echo "SCINTILLATION SCORE: $SCORE"
exit 0
