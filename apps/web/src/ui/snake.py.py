
import pygame
import sys
import time
import random

# Initialize Pygame
pygame.init()

# Set up some constants
WIDTH = 800
HEIGHT = 600
FPS = 10

# Create the game window
window = pygame.display.set_mode((WIDTH, HEIGHT))

# Set up some colors
WHITE = (255, 255, 255)
RED = (255, 0, 0)
GREEN = (0, 255, 0)

# Set up the font for the score
font = pygame.font.Font(None, 36)

class SnakeGame:
    def __init__(self):
        self.snake = [(200, 200), (220, 200), (240, 200)]
        self.direction = 'RIGHT'
        self.apple = None

    def draw_snake(self):
        for x, y in self.snake:
            pygame.draw.rect(window, GREEN, (x, y, 20, 20))

    def move_snake(self):
        head = self.snake[-1]
        if self.direction == 'UP':
            new_head = (head[0], head[1] - 20)
        elif self.direction == 'DOWN':
            new_head = (head[0], head[1] + 20)
        elif self.direction == 'LEFT':
            new_head = (head[0] - 20, head[1])
        elif self.direction == 'RIGHT':
            new_head = (head[0] + 20, head[1])

        self.snake.append(new_head)

        if self.apple == None:
            self.apple = random.choice([(x//20*20, y//20*20) for x in range(0, WIDTH, 20) for y in range(0,
HEIGHT, 20)])

        if new_head[0] < 0 or new_head[0] > WIDTH - 20:
            self.direction = 'UP' if new_head[1] == 200 else 'DOWN'
        elif new_head[1] < 0 or new_head[1] > HEIGHT - 20:
            self.direction = 'LEFT' if new_head[0] == 200 else 'RIGHT'

        for x, y in self.snake[:-1]:
            if (new_head[0] == x and new_head[1] == y):
                return False

        return True

    def check_collision(self):
        head = self.snake[-1]
        if head[0] < 0 or head[0] > WIDTH - 20:
            if head[1] == 200:
                return True
        elif head[1] < 0 or head[1] > HEIGHT - 20:
            if head[0] == 200:
                return True

        for x, y in self.snake[:-1]:
            if (head[0] == x and head[1] == y):
                return True
        return False

    def check_apple_collision(self):
        if self.apple == None or not ((self.apple[0] - 20) // 20 == self.snake[-1][0] // 20 and (self.apple[1] -
20) // 20 == self.snake[-1][1] // 20):
            return False
        else:
            return True

    def get_score(self):
        return len(self.snake)

def main():
    clock = pygame.time.Clock()
    game = SnakeGame()

    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_UP and game.direction != 'DOWN':
                    game.direction = 'UP'
                elif event.key == pygame.K_DOWN and game.direction != 'UP':
                    game.direction = 'DOWN'
                elif event.key == pygame.K_LEFT and game.direction != 'RIGHT':
                    game.direction = 'LEFT'
                elif event.key == pygame.K_RIGHT and game.direction != 'LEFT':
                    game.direction = 'RIGHT'

        game.apple = None

        if not game.move_snake():
            break
        game.apple = random.choice([(x//20*20, y//20*20) for x in range(0, WIDTH, 20) for y in range(0, HEIGHT,
20)])

        score = game.get_score()
        if game.check_apple_collision() and not ((game.apple[0] - 20) // 20 == (200 - 20) // 20 and (game.apple[1]
- 20) // 20 == (200 - 20) // 20):
            score += 1
            game.snake.append((220, 200))
        elif not game.check_collision():
            if len(game.snake) > score:
                score -= 1

        window.fill(WHITE)

        game.draw_snake()

        text = font.render(f'Score: {score}', True, RED)
        window.blit(text, (10, 10))

        pygame.display.update()
        clock.tick(FPS)

    if not game.check_collision():
        print('Game Over! Final score:', game.get_score())

if __name__ == '__main__':
    main()