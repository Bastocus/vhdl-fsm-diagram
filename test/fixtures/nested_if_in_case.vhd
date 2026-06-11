-- Phase 1: the user's reported corner case.
-- Nested if/elsif/else inside a nested case inside a when arm.
-- Combines all nesting levels.
--
-- EXPECT idle -> s_mode_a | mode = MODE_A and cond = '1'
-- EXPECT idle -> s_mode_b | mode = MODE_B and cond = '0'
-- EXPECT idle -> fallback | not (mode = MODE_A) and not (mode = MODE_B)
-- EXPECT s_mode_a -> idle | (always)
-- EXPECT s_mode_b -> idle | (always)
-- EXPECT fallback -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_nested_complex is
end fsm_nested_complex;

architecture rtl of fsm_nested_complex is
  type state_t is (idle, s_mode_a, s_mode_b, fallback);
  type mode_t is (MODE_A, MODE_B, MODE_C);
  signal state : state_t;
  signal mode : mode_t;
  signal cond : std_logic;
begin
  process
  begin
    case state is
      when idle =>
        case mode is
          when MODE_A =>
            if cond = '1' then
              state <= s_mode_a;
            end if;
          when MODE_B =>
            if cond = '0' then
              state <= s_mode_b;
            end if;
          when others =>
            state <= fallback;
        end case;
      when s_mode_a =>
        state <= idle;
      when s_mode_b =>
        state <= idle;
      when fallback =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
