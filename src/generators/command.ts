import type { CommandFeatureT, ModSpec } from "../schemas.js";
import { humanize, javaString, parseItemRef } from "./utils.js";
import { emptyContribution, type FeatureContribution } from "./types.js";

/**
 * Generates a Fabric `/<command>` registration that gives an item to the
 * executing player. Uses the verified 1.20.1 pattern:
 *   - CommandRegistrationCallback.EVENT.register(...)
 *   - CommandManager.literal("<name>")
 *   - .requires(s -> s.hasPermissionLevel(<level>))
 *   - .executes(ctx -> { ctx.getSource().getPlayerOrThrow().giveItemStack(...); return 1; })
 *   - sendFeedback uses the Supplier overload (no String overload exists in 1.20+).
 *
 * Item lookup uses `Registries.ITEM.get(new Identifier(...))` so we don't
 * need to know whether the item is a static field on this mod's class.
 */
export function generateCommand(
  spec: ModSpec,
  feature: CommandFeatureT,
): FeatureContribution {
  const c = emptyContribution();
  const d = feature.details;
  const ref = parseItemRef(d.action.itemId, spec.modId);
  const display =
    feature.details.commandName ??
    humanize(feature.name) ??
    humanize(feature.id);

  c.imports.push(
    "com.mojang.brigadier.Command",
    "net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback",
    "net.minecraft.item.Item",
    "net.minecraft.item.ItemStack",
    "net.minecraft.registry.Registries",
    "net.minecraft.server.command.CommandManager",
    "net.minecraft.text.Text",
    "net.minecraft.util.Identifier",
  );

  const registration = `        dispatcher.register(
            CommandManager.literal("${d.commandName}")
                .requires(source -> source.hasPermissionLevel(${d.permissionLevel}))
                .executes(ctx -> {
                    Item item = Registries.ITEM.get(new Identifier("${ref.namespace}", "${ref.path}"));
                    ItemStack stack = new ItemStack(item, ${d.action.count});
                    ctx.getSource().getPlayerOrThrow().giveItemStack(stack);
                    ctx.getSource().sendFeedback(() -> Text.literal("${javaString(`Gave ${d.action.count}x ${ref.full}`)}"), false);
                    return Command.SINGLE_SUCCESS;
                })
        );`;

  c.commandRegisters.push(registration);
  // Commands themselves are not translatable resources, but if the planner
  // wants a translation key for the command name, we include one.
  c.langEntries[`commands.${spec.modId}.${d.commandName}`] = `/${d.commandName}`;
  // Suppress lint: display is currently unused but reserved for future help text.
  void display;
  return c;
}
