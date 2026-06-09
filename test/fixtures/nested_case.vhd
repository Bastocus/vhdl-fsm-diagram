-- Phase 1: nested case inside a when arm.
-- Parser v0.2 skips the inner case, losing the selector condition.
-- Phase 1 will track selector conditions through nested cases.
--
-- EXPECT idle -> state_a | mode = MODE_A
-- EXPECT idle -> state_b | mode = MODE_B
-- EXPECT idle -> state_c | not (mode = MODE_A) and not (mode = MODE_B)
-- EXPECT state_a -> idle | (always)
-- EXPECT state_b -> idle | (always)
-- EXPECT state_c -> idle | (always)

library IEEE;
use IEEE.STD_LOGIC_1164.all;

entity fsm_nested_case is
end fsm_nested_case;

architecture rtl of fsm_nested_case is
  type state_t is (idle, state_a, state_b, state_c);
  type mode_t is (MODE_A, MODE_B, MODE_C);
  signal state : state_t;
  signal mode : mode_t;
begin
  process
  begin
    case state is
      when idle =>
        case mode is
          when MODE_A =>
            state <= state_a;
          when MODE_B =>
            state <= state_b;
          when others =>
            state <= state_c;
        end case;
      when state_a =>
        state <= idle;
      when state_b =>
        state <= idle;
      when state_c =>
        state <= idle;
    end case;
    wait;
  end process;
end rtl;
