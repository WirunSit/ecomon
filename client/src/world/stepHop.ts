import type Phaser from "phaser";

/**
 * ท่าเดินของมอนสเตอร์บนแผนที่ (หัวข้อ 14.1 ทำด้วยโค้ด): เด้งขึ้น + ยืดหด 1 ครั้งต่อ 1 ช่อง
 * body = container ที่ห่อภาพไว้ วางที่ระดับเท้า (baseY) เพื่อให้ยืดหดรอบเท้า ไม่ชนกับ tween ท่ายืนของภาพข้างใน
 */
export function stepHop(scene: Phaser.Scene, body: Phaser.GameObjects.Container, baseY: number, durationMs: number, height: number) {
  scene.tweens.killTweensOf(body);
  body.setY(baseY).setScale(1);
  const half = Math.max(60, durationMs / 2);
  if (height > 0) scene.tweens.add({ targets: body, y: baseY - height, duration: half, yoyo: true, ease: "Sine.easeOut" });
  scene.tweens.add({ targets: body, scaleX: 0.9, scaleY: 1.1, duration: half, yoyo: true, ease: "Sine.easeInOut" });
}
